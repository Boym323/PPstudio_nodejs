import { AvailabilitySlotServiceRestrictionMode } from "@/generated/prisma/browser";

import {
  buildSlotTimeOptions,
  filterTimeOptionsForAutoLunch,
  getAutoLunchBoundaryStartCandidates,
} from "@/features/booking/lib/booking-time-slots";

import { getSlotDateKey, getSlotDurationMinutes } from "./helpers";

const publicAvailabilityErrorCodes = new Set([
  "SLOT_UNAVAILABLE",
  "SLOT_NOT_ALLOWED",
  "SLOT_TOO_SHORT",
]);

const rescheduleAvailabilityErrorCodes = new Set([
  "SLOT_UNAVAILABLE",
  "SLOT_NOT_ALLOWED",
  "SLOT_TOO_SHORT",
  "CONFLICT",
  "CONCURRENT_MODIFICATION",
]);

export const availabilityRefreshMessage =
  "Tento termín byl mezitím obsazen. Nabídku jsme aktualizovali, vyberte prosím jiný čas.";

export function isPublicBookingAvailabilityError(errorCode?: string, suggestedStep?: number) {
  return Boolean(
    errorCode
      && (publicAvailabilityErrorCodes.has(errorCode)
        || (errorCode === "BOOKING_CONFLICT" && suggestedStep === 2)),
  );
}

export function isRescheduleAvailabilityError(errorCode?: string) {
  return Boolean(errorCode && rescheduleAvailabilityErrorCodes.has(errorCode));
}

export function getAvailabilityRefreshKey(input: {
  availabilityErrorId?: string;
  retry: number;
  isSubmitting: boolean;
}) {
  if (!input.availabilityErrorId || input.isSubmitting) {
    return null;
  }

  return `${input.availabilityErrorId}:${input.retry}`;
}

export function canApplyAvailabilityRefresh(requestRevision: number, currentRevision: number) {
  return requestRevision === currentRevision;
}

export function getRefreshedSelectedDateKey(currentDateKey: string, availableDateKeys: string[]) {
  return availableDateKeys.includes(currentDateKey) ? currentDateKey : availableDateKeys[0] ?? "";
}

export function getRefreshedDateSelection(currentDateKey: string, availableDateKeys: string[]) {
  const selectedDateKey = getRefreshedSelectedDateKey(currentDateKey, availableDateKeys);

  return {
    selectedDateKey,
    visibleMonthKey: selectedDateKey.slice(0, 7),
  };
}

type AvailabilityCatalogInput = {
  slots: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    publicNote: string | null;
    capacity: number;
    serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode;
    allowedServiceIds: string[];
    bookedIntervals: Array<{ startsAt: string; endsAt: string }>;
    segments?: Array<{ id: string; startsAt: string; endsAt: string }>;
  }>;
  scheduleOptimization?: Parameters<typeof filterTimeOptionsForAutoLunch>[1]["scheduleOptimization"];
};

export function getAvailableDateKeysForAvailability(
  catalog: AvailabilityCatalogInput,
  serviceId: string,
  serviceDurationMinutes: number,
  cleanupBlockMinutes: number,
  excludedStartsAt?: string,
) {
  if (!serviceId) {
    return [];
  }

  const eligibleSlots = catalog.slots
      .filter((slot) => getSlotDurationMinutes(slot) >= serviceDurationMinutes)
      .filter(
        (slot) => slot.serviceRestrictionMode === AvailabilitySlotServiceRestrictionMode.ANY
          || slot.allowedServiceIds.includes(serviceId),
      );
  const capacity = eligibleSlots.every((slot) => slot.capacity === 1) ? 1 : 2;
  const autoLunchBoundaryStartCandidates = capacity === 1 && catalog.scheduleOptimization
    ? getAutoLunchBoundaryStartCandidates(catalog.scheduleOptimization)
    : [];
  const options = eligibleSlots
    .flatMap((slot) => buildSlotTimeOptions(
      slot,
      serviceDurationMinutes,
      cleanupBlockMinutes,
      autoLunchBoundaryStartCandidates,
    ));
  const lunchSafeOptions = catalog.scheduleOptimization
    ? filterTimeOptionsForAutoLunch(options, {
        serviceDurationMinutes,
        cleanupBlockMinutes,
        capacity,
        scheduleOptimization: catalog.scheduleOptimization,
      })
    : options;

  return [...new Set(
    lunchSafeOptions
      .filter((option) => !option.isDisabled)
      .filter((option) => option.startsAt !== excludedStartsAt)
      .map((option) => getSlotDateKey(option.startsAt))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}
