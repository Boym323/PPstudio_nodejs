"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  initialManagePublicBookingActionState,
} from "@/features/booking/actions/manage-public-booking-action-state";
import {
  managePublicBookingAction,
  refreshPublicBookingManagementAction,
  startPublicBookingCancellationAction,
} from "@/features/booking/actions/manage-public-booking";
import type { PublicBookingManagementPageState } from "@/features/booking/lib/booking-management";
import {
  buildSlotTimeOptions,
  filterTimeOptionsForAutoLunch,
  getAutoLunchBoundaryStartCandidates,
  groupSlotsByDayPeriod,
} from "@/features/booking/lib/booking-time-slots";
import type { TimeSlotOption } from "@/features/booking/lib/booking-time-slots";
import { trackMatomoEvent } from "@/features/analytics/matomo";
import { cn } from "@/lib/utils";
import {
  getAvailableDateKeysForAvailability,
  canApplyAvailabilityRefresh,
  getAvailabilityRefreshKey,
  getRefreshedDateSelection,
  getRefreshedSelectedDateKey,
  isRescheduleAvailabilityError,
} from "./booking-flow/availability-refresh";

type BookingManagementPanelProps = {
  token: string;
  initialState: PublicBookingManagementPageState;
  salonContact: {
    email: string;
    phone: string;
  };
};

const MATOMO_CATEGORY = "Správa rezervace";

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Prague",
  }).format(new Date(value));
}

function formatShortDateLabel(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
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

function formatDateKey(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Prague",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : value.slice(0, 10);
}

function formatDateKeyLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map((part) => Number(part));

  if (!year || !month || !day) {
    return "";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Prague",
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map((part) => Number(part));

  if (!year || !month) {
    return "";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Prague",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}

function formatTimeRange(startsAt: string, endsAt: string) {
  return `${formatTimeLabel(startsAt)} – ${formatTimeLabel(endsAt)}`;
}

function getMonthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function getDayNumber(dateKey: string) {
  return String(Number(dateKey.split("-")[2] ?? ""));
}

function buildCalendarCells(monthKey: string) {
  const [year, month] = monthKey.split("-").map((part) => Number(part));

  if (!year || !month) {
    return [];
  }

  const firstDay = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
  const mondayFirstOffset = (firstDay.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: mondayFirstOffset }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  return cells;
}

const weekdayLabels = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"] as const;
const calendarGridStyle = {
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
} as const;

function getBookingManagementStickyOffset() {
  const bookingHeader = document.querySelector<HTMLElement>(".site-header--booking");
  const headerHeight = bookingHeader?.getBoundingClientRect().height;

  if (headerHeight) {
    return Math.ceil(headerHeight) + 16;
  }

  return window.innerWidth >= 1024 ? 112 : 88;
}

function scrollBookingManagementTargetIntoView(target: HTMLElement | null) {
  if (!target) {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      const topOffset = getBookingManagementStickyOffset();
      const bottomOffset = window.innerWidth >= 1024 ? 24 : 96;
      const isComfortablyVisible =
        rect.top >= topOffset && rect.bottom <= window.innerHeight - bottomOffset;

      if (isComfortablyVisible) {
        return;
      }

      window.scrollTo({
        top: Math.max(0, window.scrollY + rect.top - topOffset),
        behavior: "auto",
      });
    });
  });
}

function StatusCard({
  eyebrow,
  title,
  description,
  contact,
}: {
  eyebrow: string;
  title: string;
  description: string;
  contact?: {
    email: string;
    phone: string;
  };
}) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-black/6 bg-white p-8 shadow-[var(--shadow-panel)]">
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--color-accent)]">
        {eyebrow}
      </p>
      <h1 className="mt-5 font-display text-4xl text-[var(--color-foreground)]">{title}</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-muted)]">{description}</p>
      {contact ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <a
            href={`mailto:${contact.email}`}
            className="inline-flex min-h-11 items-center rounded-full border border-black/10 bg-[var(--color-surface)]/45 px-4 py-2 text-[15px] font-medium text-[var(--color-foreground)] transition hover:border-black/20 hover:bg-white"
          >
            {contact.email}
          </a>
          <a
            href={`tel:${contact.phone}`}
            className="inline-flex min-h-11 items-center rounded-full border border-black/10 bg-[var(--color-surface)]/45 px-4 py-2 text-[15px] font-medium text-[var(--color-foreground)] transition hover:border-black/20 hover:bg-white"
          >
            {contact.phone}
          </a>
        </div>
      ) : null}
    </section>
  );
}

type SlotButtonProps = {
  slot: TimeSlotOption;
  isSelected: boolean;
  onSelect: (slot: TimeSlotOption) => void;
};

function SlotButton({ slot, isSelected, onSelect }: SlotButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Vybrat čas ${formatTimeRange(slot.startsAt, slot.endsAt)} dne ${formatDateLabel(slot.startsAt)}`}
      aria-pressed={isSelected}
      onClick={() => onSelect(slot)}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold outline-none transition-all duration-150",
        isSelected
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white shadow-[0_10px_22px_rgba(0,0,0,0.16)] ring-2 ring-[var(--color-accent)]/25 ring-offset-2 ring-offset-white"
          : "border-[var(--color-accent)]/18 bg-white text-[var(--color-foreground)] hover:border-[var(--color-accent)]/45 hover:bg-[var(--color-surface-strong)]/20 active:scale-[0.99] focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/20",
      )}
    >
      {formatTimeLabel(slot.startsAt)}
    </button>
  );
}

export function BookingManagementPanel({
  token,
  initialState: initialPageState,
  salonContact,
}: BookingManagementPanelProps) {
  const [serverState, formAction, isSubmitting] = useActionState(
    managePublicBookingAction,
    initialManagePublicBookingActionState,
  );
  const [currentState, setCurrentState] = useState(initialPageState);
  const [isRefreshingAvailability, setIsRefreshingAvailability] = useState(false);
  const [availabilityRefreshError, setAvailabilityRefreshError] = useState("");
  const [availabilityRefreshRetry, setAvailabilityRefreshRetry] = useState(0);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedStartsAt, setSelectedStartsAt] = useState("");
  const confirmationRef = useRef<HTMLElement | null>(null);
  const selectedDaySlotsRef = useRef<HTMLDivElement | null>(null);
  const lastTrackedDateRef = useRef("");
  const lastTrackedTimeRef = useRef("");
  const rescheduleOpenedTrackedRef = useRef(false);
  const rescheduleSubmittedTrackedRef = useRef(false);
  const availabilityRefreshRequestRef = useRef(0);
  const lastRefreshedConflictRef = useRef("");
  const formRevisionRef = useRef(0);

  const slotOptions = useMemo(() => {
    if (currentState.status !== "ready") {
      return [];
    }

    const eligibleSlots = currentState.slots.filter((slot) => {
      if (
        slot.serviceRestrictionMode === "SELECTED"
        && !slot.allowedServiceIds.includes(currentState.serviceId)
      ) {
        return false;
      }

      return true;
    });
    const capacity = eligibleSlots.every((slot) => slot.capacity === 1) ? 1 : 2;
    const autoLunchBoundaryStartCandidates = capacity === 1
      ? getAutoLunchBoundaryStartCandidates(currentState.scheduleOptimization)
      : [];
    const options = eligibleSlots.flatMap((slot) => buildSlotTimeOptions(
      slot,
      currentState.serviceDurationMinutes,
      currentState.cleanupBlockMinutes,
      autoLunchBoundaryStartCandidates,
    ));
    const lunchSafeOptions = filterTimeOptionsForAutoLunch(options, {
      serviceDurationMinutes: currentState.serviceDurationMinutes,
      cleanupBlockMinutes: currentState.cleanupBlockMinutes,
      capacity,
      scheduleOptimization: currentState.scheduleOptimization,
    });

    return lunchSafeOptions
      .filter((option) => !option.isDisabled)
      .filter((option) => option.startsAt !== currentState.scheduledStartsAt);
  }, [currentState]);

  const slotGroups = useMemo(() => {
    const grouped = new Map<string, typeof slotOptions>();

    for (const option of slotOptions) {
      const key = formatDateKey(option.startsAt);
      const current = grouped.get(key) ?? [];
      current.push(option);
      grouped.set(key, current);
    }

    return Array.from(grouped.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  }, [slotOptions]);

  const firstAvailableDateKey = slotGroups[0]?.[0] ?? "";
  const [selectedDateKey, setSelectedDateKey] = useState(firstAvailableDateKey);
  const [visibleMonthKey, setVisibleMonthKey] = useState(getMonthKey(firstAvailableDateKey));

  const availableDateKeys = useMemo(
    () => slotGroups.map(([dateKey]) => dateKey),
    [slotGroups],
  );
  const effectiveSelectedDateKey = getRefreshedSelectedDateKey(selectedDateKey, availableDateKeys);
  const availableMonths = useMemo(() => {
    return Array.from(new Set(availableDateKeys.map((dateKey) => getMonthKey(dateKey)))).filter(Boolean);
  }, [availableDateKeys]);

  const effectiveVisibleMonthKey =
    visibleMonthKey && availableMonths.includes(visibleMonthKey)
      ? visibleMonthKey
      : getMonthKey(effectiveSelectedDateKey) || availableMonths[0] || "";
  const calendarCells = useMemo(
    () => buildCalendarCells(effectiveVisibleMonthKey),
    [effectiveVisibleMonthKey],
  );
  const availableSlotsByDate = useMemo(() => new Map(slotGroups), [slotGroups]);
  const selectedDateSlots = useMemo(
    () => availableSlotsByDate.get(effectiveSelectedDateKey) ?? [],
    [availableSlotsByDate, effectiveSelectedDateKey],
  );
  const selectedDateSlotGroups = useMemo(
    () => groupSlotsByDayPeriod(selectedDateSlots),
    [selectedDateSlots],
  );

  const suggestedSlotGroups = slotGroups.slice(0, 4);

  const selectedOption = slotOptions.find(
    (option) => option.slotId === selectedSlotId && option.startsAt === selectedStartsAt,
  );
  const selectedTimeRange = selectedOption
    ? formatTimeRange(selectedOption.startsAt, selectedOption.endsAt)
    : "";

  useEffect(() => {
    if (currentState.status !== "ready" || rescheduleOpenedTrackedRef.current) {
      return;
    }

    rescheduleOpenedTrackedRef.current = true;
    trackMatomoEvent(MATOMO_CATEGORY, "Změna termínu otevřena", currentState.serviceName);
  }, [currentState]);

  useEffect(() => {
    if (serverState.status === "error") {
      rescheduleSubmittedTrackedRef.current = false;
    }
  }, [serverState]);

  useEffect(() => {
    if (serverState.status !== "error" || !isRescheduleAvailabilityError(serverState.errorCode)) {
      return;
    }

    const conflictKey = getAvailabilityRefreshKey({
      availabilityErrorId: serverState.availabilityErrorId,
      retry: availabilityRefreshRetry,
      isSubmitting,
    });

    if (!conflictKey || lastRefreshedConflictRef.current === conflictKey) {
      return;
    }

    lastRefreshedConflictRef.current = conflictKey;
    const requestId = availabilityRefreshRequestRef.current + 1;
    const requestRevision = formRevisionRef.current;
    availabilityRefreshRequestRef.current = requestId;
    setIsRefreshingAvailability(true);
    setAvailabilityRefreshError("");

    void refreshPublicBookingManagementAction(token)
      .then((nextState) => {
        if (availabilityRefreshRequestRef.current !== requestId) {
          return;
        }

        setCurrentState(nextState);

        if (!canApplyAvailabilityRefresh(requestRevision, formRevisionRef.current)) {
          return;
        }

        const nextAvailableDateKeys = nextState.status === "ready"
          ? getAvailableDateKeysForAvailability(
            nextState,
            nextState.serviceId,
            nextState.serviceDurationMinutes,
            nextState.cleanupBlockMinutes,
            nextState.scheduledStartsAt,
          )
          : [];
        const refreshedSelection = getRefreshedDateSelection(selectedDateKey, nextAvailableDateKeys);
        setSelectedSlotId("");
        setSelectedStartsAt("");
        setSelectedDateKey(refreshedSelection.selectedDateKey);
        setVisibleMonthKey(refreshedSelection.visibleMonthKey);
      })
      .catch(() => {
        if (availabilityRefreshRequestRef.current === requestId) {
          setAvailabilityRefreshError("Aktuální termíny se nepodařilo načíst. Zkuste to prosím znovu.");
        }
      })
      .finally(() => {
        if (availabilityRefreshRequestRef.current === requestId) {
          setIsRefreshingAvailability(false);
        }
      });
  }, [availabilityRefreshRetry, isSubmitting, selectedDateKey, serverState, token]);

  const trackDateSelected = (dateKey: string) => {
    if (!dateKey || lastTrackedDateRef.current === dateKey) {
      return;
    }

    lastTrackedDateRef.current = dateKey;
    trackMatomoEvent(MATOMO_CATEGORY, "Datum vybráno", dateKey);
  };

  const trackTimeSelected = (slot: TimeSlotOption) => {
    const eventName = formatTimeRange(slot.startsAt, slot.endsAt);

    if (lastTrackedTimeRef.current === `${slot.slotId}:${slot.startsAt}`) {
      return;
    }

    lastTrackedTimeRef.current = `${slot.slotId}:${slot.startsAt}`;
    trackMatomoEvent(MATOMO_CATEGORY, "Čas vybrán", eventName);
  };

  const selectDate = (dateKey: string) => {
    formRevisionRef.current += 1;
    setSelectedDateKey(dateKey);
    setVisibleMonthKey(getMonthKey(dateKey));
    trackDateSelected(dateKey);
    scrollBookingManagementTargetIntoView(selectedDaySlotsRef.current);
  };

  const selectSlot = (slot: TimeSlotOption) => {
    formRevisionRef.current += 1;
    const dateKey = formatDateKey(slot.startsAt);

    setSelectedDateKey(dateKey);
    setVisibleMonthKey(getMonthKey(dateKey));
    setSelectedSlotId(slot.slotId);
    setSelectedStartsAt(slot.startsAt);
    trackDateSelected(dateKey);
    trackTimeSelected(slot);
    scrollBookingManagementTargetIntoView(confirmationRef.current);
  };

  if (serverState.status === "success" && serverState.result) {
    return (
      <section className="rounded-[var(--radius-panel)] border border-black/6 bg-white p-6 shadow-[var(--shadow-panel)] sm:p-8 lg:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--color-accent)]">
          Termín změněn
        </p>
        <h1 className="mt-5 max-w-4xl font-display text-4xl text-[var(--color-foreground)] sm:text-5xl">
          Rezervace byla úspěšně přesunuta.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-muted)]">
          Potvrzení o změně vám pošleme e-mailem.
        </p>

        <dl className="mt-8 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-black/6 bg-[var(--color-surface)]/32 p-4">
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
              Původní termín
            </dt>
            <dd className="mt-2 text-lg font-semibold leading-7 text-[var(--color-foreground)]">
              {serverState.result.previousScheduledAtLabel}
            </dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-accent)]/28 bg-[var(--color-accent)]/8 p-4">
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
              Nový termín
            </dt>
            <dd className="mt-2 text-lg font-semibold leading-7 text-[var(--color-foreground)]">
              {serverState.result.scheduledAtLabel}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  if (currentState.status !== "ready") {
    return (
      <StatusCard
        eyebrow="Správa rezervace"
        title="Tuto rezervaci teď nelze změnit online."
        description={currentState.message}
        contact={salonContact}
      />
    );
  }

  return (
    <section className="space-y-5 pb-28 sm:space-y-6 lg:pb-0">
      <section className="rounded-[var(--radius-panel)] border border-black/6 bg-white p-6 shadow-[var(--shadow-panel)] sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--color-accent)]">
          Správa rezervace
        </p>
        <h1 className="mt-5 font-display text-4xl text-[var(--color-foreground)] sm:text-5xl">
          Změna termínu rezervace
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-muted)]">
          Vyberte si nový termín, který vám vyhovuje. Změnu lze provést nejpozději
          {` ${currentState.cancellationHours} hodin před začátkem.`}
        </p>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-black/6 bg-white p-5 shadow-[var(--shadow-panel)] sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-black/6 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-accent)]">
              Aktuální rezervace
            </p>
            <h2 className="mt-2 text-xl font-semibold text-[var(--color-foreground)]">
              {currentState.serviceName}
            </h2>
          </div>
          <span className="rounded-full border border-black/8 bg-[var(--color-surface)]/45 px-3 py-1.5 text-xs font-semibold text-[var(--color-foreground)]">
            {currentState.statusLabel}
          </span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">Služba</dt>
            <dd className="mt-1 font-semibold text-[var(--color-foreground)]">{currentState.serviceName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">Datum</dt>
            <dd className="mt-1 font-semibold text-[var(--color-foreground)]">{formatDateLabel(currentState.scheduledStartsAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">Čas</dt>
            <dd className="mt-1 font-semibold text-[var(--color-foreground)]">
              {formatTimeRange(currentState.scheduledStartsAt, currentState.scheduledEndsAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">Stav</dt>
            <dd className="mt-1 font-semibold text-[var(--color-foreground)]">
              {currentState.statusLabel}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-black/6 bg-white p-5 shadow-[var(--shadow-panel)] sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--color-accent)]">
            Výběr nového termínu
          </p>
          <h2 className="mt-3 font-display text-3xl text-[var(--color-foreground)]">
            Nejbližší dostupné termíny
          </h2>
        </div>

        {suggestedSlotGroups.length > 0 ? (
          <div className="mt-6 grid gap-4">
            {suggestedSlotGroups.map(([dateKey, options]) => (
              <section
                key={dateKey}
                className="rounded-3xl border border-black/6 bg-[var(--color-surface)]/24 p-4 sm:p-5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-semibold text-[var(--color-foreground)]">
                    {formatDateKeyLabel(dateKey)}
                  </h3>
                  <span className="text-xs font-medium text-[var(--color-muted)]">
                    {options.length} {options.length === 1 ? "čas" : options.length < 5 ? "časy" : "časů"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {options.map((option) => {
                    const isSelected = option.slotId === selectedSlotId && option.startsAt === selectedStartsAt;

                    return (
                      <SlotButton
                        key={option.key}
                        slot={option}
                        isSelected={isSelected}
                        onSelect={selectSlot}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-3xl border border-dashed border-black/12 bg-[var(--color-surface)]/35 p-5 text-base leading-7 text-[var(--color-muted)]">
            Žádné dostupné termíny.
          </div>
        )}

        {slotGroups.length > 0 ? (
          <div className="mt-8 rounded-3xl border border-black/6 bg-[var(--color-surface)]/18 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[var(--color-foreground)]">
                  Vybrat konkrétní den
                </h3>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  {formatMonthLabel(effectiveVisibleMonthKey)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const monthIndex = availableMonths.indexOf(effectiveVisibleMonthKey);
                    const previousMonth = availableMonths[monthIndex - 1];
                    if (previousMonth) {
                      setVisibleMonthKey(previousMonth);
                    }
                  }}
                  disabled={availableMonths.indexOf(effectiveVisibleMonthKey) <= 0}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/8 bg-white text-xl text-[var(--color-foreground)] transition hover:border-black/16 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="Předchozí měsíc"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const monthIndex = availableMonths.indexOf(effectiveVisibleMonthKey);
                    const nextMonth = availableMonths[monthIndex + 1];
                    if (nextMonth) {
                      setVisibleMonthKey(nextMonth);
                    }
                  }}
                  disabled={availableMonths.indexOf(effectiveVisibleMonthKey) >= availableMonths.length - 1}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/8 bg-white text-xl text-[var(--color-foreground)] transition hover:border-black/16 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="Další měsíc"
                >
                  ›
                </button>
              </div>
            </div>

            <div
              className="mt-5 grid gap-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)] sm:gap-2"
              style={calendarGridStyle}
            >
              {weekdayLabels.map((dayLabel) => (
                <span key={dayLabel}>{dayLabel}</span>
              ))}
            </div>

            <div className="mt-2 grid gap-1.5 sm:gap-2" style={calendarGridStyle}>
              {calendarCells.map((dateKey, index) => {
                if (!dateKey) {
                  return <div key={`calendar-empty-${index}`} className="h-10 rounded-xl bg-[var(--color-surface)]/24 sm:h-12" />;
                }

                const dateSlots = availableSlotsByDate.get(dateKey) ?? [];
                const hasSlots = dateSlots.length > 0;
                const isSelectedDate = dateKey === effectiveSelectedDateKey;

                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => selectDate(dateKey)}
                    disabled={!hasSlots}
                    aria-label={hasSlots ? `Vybrat den ${formatDateKeyLabel(dateKey)}` : `${formatDateKeyLabel(dateKey)} bez dostupných časů`}
                    className={cn(
                      "relative h-10 rounded-xl border text-sm font-semibold outline-none transition sm:h-12 sm:rounded-2xl",
                      hasSlots
                        ? "border-black/8 bg-white text-[var(--color-foreground)] hover:border-[var(--color-accent)]/35 hover:bg-[var(--color-surface-strong)]/20 focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/20"
                        : "cursor-not-allowed border-transparent bg-[var(--color-surface)]/18 text-[var(--color-muted)]/35",
                      isSelectedDate && hasSlots
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white shadow-[0_8px_18px_rgba(0,0,0,0.14)]"
                        : "",
                    )}
                  >
                    {getDayNumber(dateKey)}
                    {hasSlots && !isSelectedDate ? (
                      <span className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--color-accent)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div
          ref={selectedDaySlotsRef}
          className={cn(
            "mt-6 scroll-mt-32 rounded-3xl border p-4 transition-all duration-300 sm:p-5 lg:scroll-mt-28",
            selectedDateSlots.length > 0
              ? "border-[var(--color-accent)]/20 bg-[var(--color-surface-strong)]/16"
              : "border-dashed border-black/10 bg-[var(--color-surface)]/20",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[var(--color-foreground)]">
                Sloty pro vybraný den
              </h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                {effectiveSelectedDateKey ? formatDateKeyLabel(effectiveSelectedDateKey) : "Vyberte den v kalendáři."}
              </p>
            </div>
          </div>

          {selectedDateSlots.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white/55 px-4 py-5 text-sm text-[var(--color-muted)]">
              Pro tento den nejsou sloty.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {selectedDateSlotGroups.map((group) => (
                <section key={group.key} className="space-y-2">
                  {group.label ? (
                    <div className="flex items-center gap-2">
                      <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                        {group.label}
                      </h4>
                      <div className="h-px flex-1 bg-black/6" />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {group.slots.map((slot) => (
                      <SlotButton
                        key={slot.key}
                        slot={slot}
                        isSelected={slot.slotId === selectedSlotId && slot.startsAt === selectedStartsAt}
                        onSelect={selectSlot}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {serverState.status === "error" && serverState.formError ? (
          <div role="alert" className="mt-6 rounded-3xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>{serverState.formError}</p>
            {isRefreshingAvailability ? (
              <p className="mt-2">Aktualizujeme nabídku dostupných termínů…</p>
            ) : availabilityRefreshError ? (
              <button
                type="button"
                onClick={() => setAvailabilityRefreshRetry((value) => value + 1)}
                className="mt-3 font-semibold underline underline-offset-4"
              >
                Zkusit načtení znovu
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section
        ref={confirmationRef}
        className="scroll-mt-32 rounded-[var(--radius-panel)] border border-black/6 bg-white p-5 shadow-[var(--shadow-panel)] sm:p-8 lg:scroll-mt-28"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--color-accent)]">
          Potvrdit nový termín
        </p>
        <h2 className="mt-5 font-display text-3xl text-[var(--color-foreground)]">
          Potvrdit nový termín
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-muted)]">
          Změna se uloží až po potvrzení.
        </p>

        <dl className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-black/6 bg-[var(--color-surface)]/32 p-4">
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">Služba</dt>
            <dd className="mt-2 text-lg font-semibold text-[var(--color-foreground)]">
              {currentState.serviceName}
            </dd>
          </div>
          <div className="rounded-2xl border border-black/6 bg-[var(--color-surface)]/32 p-4">
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">Původní termín</dt>
            <dd className="mt-2 text-lg font-semibold text-[var(--color-foreground)]">
              {formatShortDateLabel(currentState.scheduledStartsAt)}, {formatTimeRange(currentState.scheduledStartsAt, currentState.scheduledEndsAt)}
            </dd>
          </div>
          <div className={cn(
            "rounded-2xl border p-4 transition",
            selectedOption
              ? "border-[var(--color-accent)]/35 bg-[var(--color-accent)]/8"
              : "border-black/6 bg-[var(--color-surface)]/32",
          )}>
            <dt className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">Nový termín</dt>
            <dd className="mt-2 text-lg font-semibold text-[var(--color-foreground)]">
              {selectedOption ? `${formatShortDateLabel(selectedOption.startsAt)}, ${selectedTimeRange}` : "Vyberte čas"}
            </dd>
          </div>
        </dl>

        {serverState.fieldErrors?.slotId ? (
          <p className="mt-4 text-sm text-red-700">{serverState.fieldErrors.slotId}</p>
        ) : null}

        <form
          action={formAction}
          className="mt-8"
          onSubmitCapture={(event) => {
            if (
              !selectedOption
              || rescheduleSubmittedTrackedRef.current
              || isSubmitting
              || isRefreshingAvailability
            ) {
              event.preventDefault();
              return;
            }

            rescheduleSubmittedTrackedRef.current = true;
            trackMatomoEvent(MATOMO_CATEGORY, "Změna termínu odeslána", currentState.serviceName);
          }}
        >
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="slotId" value={selectedSlotId} />
          <input type="hidden" name="newStartAt" value={selectedStartsAt} />
          <input type="hidden" name="expectedUpdatedAt" value={currentState.expectedUpdatedAt} />
          <button
            type="submit"
            disabled={!selectedOption || isSubmitting || isRefreshingAvailability}
            className="inline-flex min-h-13 w-full items-center justify-center rounded-full bg-[var(--color-foreground)] px-7 py-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#2c221d] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:text-sm"
          >
            {isSubmitting ? "Ukládám změnu…" : "Potvrdit nový termín"}
          </button>
        </form>
      </section>

      <section className="text-center">
        <form action={startPublicBookingCancellationAction}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-[var(--color-muted)] underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
          >
            Zrušit rezervaci
          </button>
        </form>
      </section>

      {selectedOption ? (
        <aside className="fixed inset-x-0 bottom-0 z-30 border-t border-black/8 bg-white/95 px-4 py-3 shadow-[0_-10px_24px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
                Vybraný termín
              </p>
              <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                {formatShortDateLabel(selectedOption.startsAt)}, {selectedTimeRange}
              </p>
            </div>
            <button
              type="button"
              onClick={() => scrollBookingManagementTargetIntoView(confirmationRef.current)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-semibold text-white"
            >
              Potvrdit
            </button>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
