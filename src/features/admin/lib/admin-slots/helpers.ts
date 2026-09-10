import { AvailabilitySlotServiceRestrictionMode, AvailabilitySlotStatus, BookingStatus } from "@/generated/prisma/browser";

import { type AdminArea } from "@/config/navigation";

import { DAY_CELLS, dateToCellIndex, timeFormatter } from "./time";
import {
  type PlannerDay,
  type TimeRange,
  PlannerMutationError,
} from "./types";

const EDITABLE_SLOT_CAPACITY = 1;

export function clampIntervalToDay(interval: TimeRange, dayStart: Date, dayEnd: Date): TimeRange | null {
  const startsAt = new Date(Math.max(interval.startsAt.getTime(), dayStart.getTime()));
  const endsAt = new Date(Math.min(interval.endsAt.getTime(), dayEnd.getTime()));

  if (endsAt <= startsAt) {
    return null;
  }

  return { startsAt, endsAt };
}

export function intervalToCellRange(interval: TimeRange) {
  return {
    startCell: dateToCellIndex(interval.startsAt),
    endCell: dateToCellIndex(interval.endsAt),
  };
}

function clampCellBoundary(value: number) {
  return Math.max(0, Math.min(DAY_CELLS, value));
}

export function intervalToPlannerCells(
  interval: TimeRange,
  mode: "cover" | "inside",
) {
  const start = dateToCellIndex(interval.startsAt);
  const end = dateToCellIndex(interval.endsAt);

  if (mode === "inside") {
    return {
      startCell: clampCellBoundary(Math.ceil(start)),
      endCell: clampCellBoundary(Math.floor(end)),
    };
  }

  return {
    startCell: clampCellBoundary(Math.floor(start)),
    endCell: clampCellBoundary(Math.ceil(end)),
  };
}

export function formatTimeRange(startsAt: Date, endsAt: Date) {
  return `${timeFormatter.format(startsAt)} - ${timeFormatter.format(endsAt)}`;
}

export function mergeIntervals(intervals: TimeRange[]) {
  const sorted = [...intervals]
    .filter((interval) => interval.endsAt > interval.startsAt)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());

  const merged: TimeRange[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);

    if (!previous) {
      merged.push({ ...interval });
      continue;
    }

    if (previous.endsAt.getTime() >= interval.startsAt.getTime()) {
      previous.endsAt = new Date(Math.max(previous.endsAt.getTime(), interval.endsAt.getTime()));
      continue;
    }

    merged.push({ ...interval });
  }

  return merged;
}

export function subtractIntervals(intervals: TimeRange[], remove: TimeRange) {
  const result: TimeRange[] = [];

  for (const interval of intervals) {
    if (remove.endsAt <= interval.startsAt || remove.startsAt >= interval.endsAt) {
      result.push(interval);
      continue;
    }

    if (remove.startsAt > interval.startsAt) {
      result.push({ startsAt: interval.startsAt, endsAt: remove.startsAt });
    }

    if (remove.endsAt < interval.endsAt) {
      result.push({ startsAt: remove.endsAt, endsAt: interval.endsAt });
    }
  }

  return result;
}

/**
 * Jediný read/write výpočet běžné dostupnosti: spojí kompatibilní intervaly a
 * odečte z nich všechny chráněné rozsahy (rezervaci včetně úklidu i omezení).
 */
export function getEditablePlannerIntervals(intervals: TimeRange[], protectedIntervals: TimeRange[]) {
  return mergeIntervals(protectedIntervals).reduce(
    (remaining, protectedInterval) => subtractIntervals(remaining, protectedInterval),
    mergeIntervals(intervals),
  );
}

export function intersectsAny(interval: TimeRange, blocked: TimeRange[]) {
  return blocked.some(
    (blockedInterval) => interval.startsAt < blockedInterval.endsAt && interval.endsAt > blockedInterval.startsAt,
  );
}

export function buildCellsMap(dayIntervals: Array<{ startCell: number; endCell: number }>) {
  const cells = Array.from({ length: DAY_CELLS }, () => false);

  for (const interval of dayIntervals) {
    for (let cell = interval.startCell; cell < interval.endCell; cell += 1) {
      cells[cell] = true;
    }
  }

  return cells;
}

export function isPlainEditableSlot(slot: {
  capacity: number;
  publicNote: string | null;
  internalNote: string | null;
  serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode;
  allowedServices: Array<{ serviceId: string }>;
}) {
  return (
    slot.capacity === EDITABLE_SLOT_CAPACITY &&
    slot.publicNote === null &&
    slot.internalNote === null &&
    slot.serviceRestrictionMode === AvailabilitySlotServiceRestrictionMode.ANY &&
    slot.allowedServices.length === 0
  );
}

export function isHiddenHistoricalCancelledSlot(slot: {
  status: AvailabilitySlotStatus;
  bookings: Array<{ id: string; status: BookingStatus }>;
}) {
  return (
    // Archivovaný slot je pouze historická stopa (typicky po přesunu
    // rezervace). I když už k němu rezervace nepatří, nesmí se v planneru
    // vykreslit jako překrývající chráněný interval.
    slot.status === AvailabilitySlotStatus.ARCHIVED ||
    (
      slot.status !== AvailabilitySlotStatus.PUBLISHED &&
      slot.bookings.length > 0 &&
      slot.bookings.every((booking) => booking.status === BookingStatus.CANCELLED)
    )
  );
}

export function isSameDateKey(left: string, right: string) {
  return left === right;
}

export function getBaseHref(area: AdminArea) {
  return area === "owner" ? "/admin/volne-terminy" : "/admin/provoz/volne-terminy";
}

export function getAreaTitle(area: AdminArea) {
  return area === "owner" ? "Týdenní plán dostupností" : "Týdenní plán termínů";
}

export function getAreaSubtitle(area: AdminArea) {
  return area === "owner"
    ? "Volné intervaly upravujete přímo v týdenním kalendáři. Rozhraní samo skládá půlhodiny do souvislých oken kompatibilních s booking flow."
    : "Termíny upravujete přímo v týdnu. Stačí kliknout nebo táhnout přes půlhodiny a rozhraní uloží souvislé volné úseky.";
}

export function getSummaryNote(day: PlannerDay) {
  if (day.bookings.length > 0) {
    return day.availableIntervals.length > 0
      ? "Den kombinuje rezervace a další volné okno."
      : "Den je svázaný s rezervacemi a dostupnost se proto nedá plně vyčistit.";
  }

  if (day.availableIntervals.length > 0) {
    return "Dostupnost lze upravit přímo v mřížce.";
  }

  if (day.lockedIntervals.length > 0) {
    return "Obsahuje omezené nebo technicky uzamčené intervaly.";
  }

  return day.isPast ? "Minulý den už jen slouží pro orientaci." : "Den je prázdný a připravený k doplnění.";
}

export function ensureHalfHourCellIndex(cell: number) {
  if (!Number.isInteger(cell) || cell < 0 || cell > DAY_CELLS) {
    throw new PlannerMutationError("Vybraný čas v kalendáři není platný.");
  }
}

export function ensureQuarterHourCellIndex(cell: number) {
  if (!Number.isFinite(cell) || !Number.isInteger(cell * 2) || cell < 0 || cell > DAY_CELLS) {
    throw new PlannerMutationError("Vybraný čas v kalendáři není platný.");
  }
}

export function isEditablePlannerSlot(slot: {
  status: AvailabilitySlotStatus;
  capacity: number;
  publicNote: string | null;
  internalNote: string | null;
  serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode;
  allowedServices: Array<{ serviceId: string }>;
}) {
  return slot.status === AvailabilitySlotStatus.PUBLISHED && isPlainEditableSlot(slot);
}

export { EDITABLE_SLOT_CAPACITY };
