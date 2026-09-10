"use client";

import { useMemo } from "react";

import {
  buildSlotTimeOptions,
  filterTimeOptionsForAutoLunch,
  getAutoLunchBoundaryStartCandidates,
  type TimeSlotOption,
} from "@/features/booking/lib/booking-time-slots";
import type { PublicBookingCatalog } from "@/features/booking/lib/booking-public";
import { resolvePragueLocalDateTime } from "@/features/booking/lib/booking-local-time";
import { cn } from "@/lib/utils";

type SlotCatalogItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  publicNote: string | null;
  capacity: number;
  serviceRestrictionMode: "ANY" | "SELECTED";
  allowedServiceIds: string[];
  bookedIntervals: Array<{
    startsAt: string;
    endsAt: string;
  }>;
};

type ServiceOption = {
  id: string;
  durationMinutes: number;
  cleanupBlockMinutes: number;
};

type BookingTimeSelectorProps = {
  slots: SlotCatalogItem[];
  scheduleOptimization: PublicBookingCatalog["scheduleOptimization"];
  services: ServiceOption[];
  serviceId: string;
  selectionMode: "slot" | "manual";
  onSelectionModeChange: (value: "slot" | "manual") => void;
  slotId: string;
  onSlotIdChange: (value: string) => void;
  startsAt: string;
  onStartsAtChange: (value: string) => void;
  manualDate: string;
  onManualDateChange: (value: string) => void;
  manualTime: string;
  onManualTimeChange: (value: string) => void;
  errorSlot?: string;
  errorManualDate?: string;
  errorManualTime?: string;
};

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Prague",
  }).format(new Date(value));
}

function formatTimeLabel(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  }).format(new Date(value));
}

function formatTimeRange(startsAt: string, endsAt: string) {
  return `${formatTimeLabel(startsAt)} – ${formatTimeLabel(endsAt)}`;
}

function buildManualPreviewStartsAt(dateValue: string, timeValue: string) {
  if (!dateValue || !timeValue) {
    return "";
  }

  const resolved = resolvePragueLocalDateTime(dateValue, timeValue);
  if (!resolved) {
    return "";
  }

  return Number.isNaN(resolved.getTime()) ? "" : resolved.toISOString();
}

export function BookingTimeSelector({
  slots,
  scheduleOptimization,
  services,
  serviceId,
  selectionMode,
  onSelectionModeChange,
  slotId,
  onSlotIdChange,
  startsAt,
  onStartsAtChange,
  manualDate,
  onManualDateChange,
  manualTime,
  onManualTimeChange,
  errorSlot,
  errorManualDate,
  errorManualTime,
}: BookingTimeSelectorProps) {
  const selectedService = services.find((service) => service.id === serviceId) ?? null;
  const slotOptions = useMemo(() => {
    if (!selectedService) {
      return [] as TimeSlotOption[];
    }

    const eligibleSlots = slots.filter((slot) => {
      if (
        slot.serviceRestrictionMode === "SELECTED"
        && !slot.allowedServiceIds.includes(selectedService.id)
      ) {
        return false;
      }

      return true;
    });
    const capacity = eligibleSlots.every((slot) => slot.capacity === 1) ? 1 : 2;
    const autoLunchBoundaryStartCandidates = capacity === 1
      ? getAutoLunchBoundaryStartCandidates(scheduleOptimization)
      : [];
    const options = eligibleSlots.flatMap((slot) => buildSlotTimeOptions(
      slot,
      selectedService.durationMinutes,
      selectedService.cleanupBlockMinutes,
      autoLunchBoundaryStartCandidates,
    ));

    return filterTimeOptionsForAutoLunch(options, {
      serviceDurationMinutes: selectedService.durationMinutes,
      cleanupBlockMinutes: selectedService.cleanupBlockMinutes,
      capacity,
      scheduleOptimization,
    }).filter((option) => !option.isDisabled);
  }, [scheduleOptimization, selectedService, slots]);
  const slotGroups = useMemo(() => {
    const grouped = new Map<string, TimeSlotOption[]>();

    for (const option of slotOptions) {
      const key = option.startsAt.slice(0, 10);
      const current = grouped.get(key) ?? [];
      current.push(option);
      grouped.set(key, current);
    }

    return Array.from(grouped.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  }, [slotOptions]);
  const manualPreviewStartsAt = buildManualPreviewStartsAt(manualDate, manualTime);
  const isManualOverridePreview =
    selectionMode === "manual"
    && manualPreviewStartsAt.length > 0
    && !slotOptions.some((option) => option.startsAt === manualPreviewStartsAt);

  return (
    <section className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent-soft)]">
        C. Termín
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">Vybrat slot nebo zadat čas ručně</h3>
      <p className="mt-1 text-sm leading-6 text-white/62">
        Slotový výběr respektuje veřejnou dostupnost. Ruční zadání dovolí interní výjimku, ale backend pořád hlídá kolize a délku služby.
      </p>

      <div className="mt-4 inline-flex rounded-full border border-white/10 bg-black/20 p-1">
        <ModeButton
          active={selectionMode === "slot"}
          label="Výběr ze slotů"
          onClick={() => onSelectionModeChange("slot")}
        />
        <ModeButton
          active={selectionMode === "manual"}
          label="Ruční zadání"
          onClick={() => onSelectionModeChange("manual")}
        />
      </div>

      {selectionMode === "slot" ? (
        <div className="mt-4 space-y-4">
          {selectedService ? (
            slotGroups.length > 0 ? (
              slotGroups.map(([dateKey, options]) => (
                <div key={dateKey} className="rounded-[1rem] border border-white/8 bg-black/14 p-3.5">
                  <p className="text-sm font-medium text-white">{formatDateLabel(options[0]?.startsAt ?? dateKey)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {options.map((option) => {
                      const isSelected = slotId === option.slotId && startsAt === option.startsAt;

                      return (
                        <button
                          key={option.key}
                          type="button"
                          aria-label={`Vybrat čas ${formatTimeRange(option.startsAt, option.endsAt)} dne ${formatDateLabel(option.startsAt)}`}
                          onClick={() => {
                            onSlotIdChange(option.slotId);
                            onStartsAtChange(option.startsAt);
                          }}
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm transition",
                            isSelected
                              ? "border-[var(--color-accent)]/45 bg-[var(--color-accent)]/12 text-white"
                              : "border-white/10 bg-white/[0.03] text-white/72 hover:border-white/18 hover:bg-white/[0.05]",
                          )}
                        >
                          {formatTimeLabel(option.startsAt)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1rem] border border-dashed border-white/14 bg-white/[0.03] p-4 text-sm text-white/62">
                Pro vybranou službu teď ve veřejných slotech nic nevyšlo. Můžete přepnout na ruční zadání a uložit interní výjimku.
              </div>
            )
          ) : (
            <div className="rounded-[1rem] border border-dashed border-white/14 bg-white/[0.03] p-4 text-sm text-white/62">
              Nejprve vyberte službu, ať víme délku rezervace.
            </div>
          )}

          {errorSlot ? <p className="text-sm text-red-300">{errorSlot}</p> : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-white">Datum</span>
            <input
              type="date"
              value={manualDate}
              onChange={(event) => onManualDateChange(event.target.value)}
              className={cn(
                "mt-2 w-full rounded-[1rem] border border-white/8 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition focus:border-[var(--color-accent)]/55",
                errorManualDate ? "border-red-300/40" : "",
              )}
            />
            {errorManualDate ? <p className="mt-2 text-sm text-red-300">{errorManualDate}</p> : null}
          </label>

          <label className="block">
            <span className="text-sm font-medium text-white">Čas od</span>
            <input
              type="time"
              step={1800}
              value={manualTime}
              onChange={(event) => onManualTimeChange(event.target.value)}
              className={cn(
                "mt-2 w-full rounded-[1rem] border border-white/8 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition focus:border-[var(--color-accent)]/55",
                errorManualTime ? "border-red-300/40" : "",
              )}
            />
            {errorManualTime ? <p className="mt-2 text-sm text-red-300">{errorManualTime}</p> : null}
          </label>

          {selectedService ? (
            <div className="rounded-[1rem] border border-white/8 bg-black/14 px-3.5 py-3 md:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/42">Délka služby</p>
              <p className="mt-2 text-sm text-white">{selectedService.durationMinutes} min</p>
            </div>
          ) : null}

          {isManualOverridePreview ? (
            <div className="rounded-[1rem] border border-amber-300/20 bg-amber-500/10 px-3.5 py-3 text-sm leading-6 text-amber-50 md:col-span-2">
              Tento termín není ve veřejné dostupnosti. Rezervace bude vytvořena jako interní výjimka.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3.5 py-2 text-sm transition",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]"
          : "text-white/68 hover:bg-white/6 hover:text-white",
      )}
    >
      {label}
    </button>
  );
}
