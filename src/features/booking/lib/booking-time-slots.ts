import type { PublicBookingCatalog } from "@/features/booking/lib/booking-public";
import {
  getNextCalendarDate,
  getPragueLocalDate,
  resolvePragueLocalDateTime,
} from "./booking-local-time";
import {
  canPreserveAutoLunch,
  generateLunchCandidates,
  shouldApplyAutoLunch,
} from "./booking-schedule-optimization";

const BOOKING_START_STEP_MINUTES = 30;
const QUARTER_HOUR_MS = 15 * 60 * 1000;

export type TimeSlotOption = {
  key: string;
  slotId: string;
  startsAt: string;
  endsAt: string;
  publicNote: string | null;
  isDisabled: boolean;
};

type DayPeriodKey = "morning" | "lateMorning" | "afternoon" | "evening";

export type TimeSlotGroupData = {
  key: DayPeriodKey | "all-day";
  label: string | null;
  slots: TimeSlotOption[];
};

function getSlotSegments(slot: PublicBookingCatalog["slots"][number]) {
  return slot.segments?.length
    ? slot.segments
    : [{
        id: slot.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      }];
}

function resolveSlotIdForStart(
  slot: PublicBookingCatalog["slots"][number],
  startsAtMs: number,
) {
  const slotSegments = getSlotSegments(slot);
  const matchingSegment = slotSegments.find((segment) => {
    const segmentStartsAtMs = new Date(segment.startsAt).getTime();
    const segmentEndsAtMs = new Date(segment.endsAt).getTime();

    return startsAtMs >= segmentStartsAtMs && startsAtMs < segmentEndsAtMs;
  });

  return matchingSegment?.id ?? slot.id;
}

function getSlotStartTime(value: string) {
  return new Date(value).getTime();
}

export function floorToQuarterHour(valueMs: number) {
  return Math.floor(valueMs / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

export function ceilToQuarterHour(valueMs: number) {
  return Math.ceil(valueMs / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

function getDayPeriod(startsAt: string): DayPeriodKey {
  const date = new Date(startsAt);
  const pragueHour = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/Prague",
  }).format(date);
  const hour = Number(pragueHour);

  if (hour < 9) {
    return "morning";
  }

  if (hour < 12) {
    return "lateMorning";
  }

  if (hour < 17) {
    return "afternoon";
  }

  return "evening";
}

function getDayPeriodLabel(period: DayPeriodKey) {
  switch (period) {
    case "morning":
      return "Ráno";
    case "lateMorning":
      return "Dopoledne";
    case "afternoon":
      return "Odpoledne";
    case "evening":
      return "Večer";
    default:
      return null;
  }
}

export function buildSlotTimeOptions(
  slot: PublicBookingCatalog["slots"][number],
  serviceDurationMinutes: number,
  cleanupBlockMinutes = 0,
  extraStartCandidates: Iterable<string> = [],
): TimeSlotOption[] {
  const slotStartsAtMs = new Date(slot.startsAt).getTime();
  const slotEndsAtMs = new Date(slot.endsAt).getTime();
  const serviceDurationMs = serviceDurationMinutes * 60 * 1000;
  const blockDurationMs = (serviceDurationMinutes + cleanupBlockMinutes) * 60 * 1000;
  const stepMs = BOOKING_START_STEP_MINUTES * 60 * 1000;
  const latestStartMs = slotEndsAtMs - serviceDurationMs;
  const bookingWindowStartMs = slot.bookingWindowStart
    ? new Date(slot.bookingWindowStart).getTime()
    : Number.NEGATIVE_INFINITY;
  const bookingWindowEndMs = slot.bookingWindowEnd
    ? new Date(slot.bookingWindowEnd).getTime()
    : Number.POSITIVE_INFINITY;

  if (latestStartMs < slotStartsAtMs) {
    return [];
  }

  const options: TimeSlotOption[] = [];
  const startCandidates = new Set<number>();
  const quarterHourCandidates = new Set<number>();
  const bookingStartsSorted = slot.bookedIntervals
    .map((booking) => new Date(booking.startsAt).getTime())
    .sort((left, right) => left - right);
  const bookingEndsSorted = slot.bookedIntervals
    .map((booking) => new Date(booking.endsAt).getTime())
    .sort((left, right) => left - right);
  let startsPointer = 0;
  let endsPointer = 0;
  let activeOverlaps = 0;

  for (let startsAtMs = slotStartsAtMs; startsAtMs <= latestStartMs; startsAtMs += stepMs) {
    startCandidates.add(startsAtMs);
  }

  for (const candidate of extraStartCandidates) {
    const startsAtMs = new Date(candidate).getTime();

    if (Number.isFinite(startsAtMs) && startsAtMs >= slotStartsAtMs && startsAtMs <= latestStartMs) {
      startCandidates.add(startsAtMs);
      quarterHourCandidates.add(startsAtMs);
    }
  }

  for (const bookingEndsAtMs of bookingEndsSorted) {
    const candidateStartsAtMs = ceilToQuarterHour(bookingEndsAtMs);

    if (
      candidateStartsAtMs >= slotStartsAtMs
      && candidateStartsAtMs <= latestStartMs
    ) {
      startCandidates.add(candidateStartsAtMs);
      quarterHourCandidates.add(candidateStartsAtMs);
    }
  }

  for (const bookingStartsAtMs of bookingStartsSorted) {
    const candidateStartsAtMs = floorToQuarterHour(bookingStartsAtMs - blockDurationMs);

    if (
      candidateStartsAtMs >= slotStartsAtMs
      && candidateStartsAtMs <= latestStartMs
    ) {
      startCandidates.add(candidateStartsAtMs);
      quarterHourCandidates.add(candidateStartsAtMs);
    }
  }

  for (const startsAtMs of [...startCandidates].sort((left, right) => left - right)) {
    const endsAtMs = startsAtMs + serviceDurationMs;
    const blockedUntilMs = startsAtMs + blockDurationMs;

    while (startsPointer < bookingStartsSorted.length && bookingStartsSorted[startsPointer] < blockedUntilMs) {
      activeOverlaps += 1;
      startsPointer += 1;
    }

    while (endsPointer < bookingEndsSorted.length && bookingEndsSorted[endsPointer] <= startsAtMs) {
      activeOverlaps -= 1;
      endsPointer += 1;
    }

    const remainingCapacity = Math.max(slot.capacity - activeOverlaps, 0);
    const startsAt = new Date(startsAtMs).toISOString();
    const endsAt = new Date(endsAtMs).toISOString();
    const slotId = resolveSlotIdForStart(slot, startsAtMs);

    const isDisabled = remainingCapacity < 1;

    if (quarterHourCandidates.has(startsAtMs) && isDisabled) {
      continue;
    }

    if (startsAtMs < bookingWindowStartMs || startsAtMs > bookingWindowEndMs) {
      continue;
    }

    options.push({
      key: `${slotId}:${startsAt}`,
      slotId,
      startsAt,
      endsAt,
      publicNote: slot.publicNote,
      isDisabled,
    });
  }

  return options;
}

/**
 * Automatický oběd není uložená rezervace, proto jeho konec nevznikne mezi
 * běžnými čtvrthodinovými kandidáty. Přidáme jej explicitně; následný filtr
 * ponechá jen variantu, pro niž oběd skutečně zůstává proveditelný.
 */
export function getAutoLunchBoundaryStartCandidates(
  scheduleOptimization: PublicBookingCatalog["scheduleOptimization"],
) {
  const availability = scheduleOptimization.publishedAvailability.map((interval) => ({
    startsAt: new Date(interval.startsAt).getTime(),
    endsAt: new Date(interval.endsAt).getTime(),
  }));
  const bookedBlocks = scheduleOptimization.bookedIntervals.map((interval) => ({
    startsAt: new Date(interval.startsAt).getTime(),
    endsAt: new Date(interval.endsAt).getTime(),
  }));
  const localDates = new Set<string>();

  for (const interval of availability) {
    localDates.add(getPragueLocalDate(new Date(interval.startsAt)));
    localDates.add(getPragueLocalDate(new Date(interval.endsAt - 1)));
  }

  return [...localDates].flatMap((localDate) => {
    const nextLocalDate = getNextCalendarDate(localDate);
    const dayStartsAt = resolvePragueLocalDateTime(localDate, "00:00")?.getTime();
    const dayEndsAt = nextLocalDate
      ? resolvePragueLocalDateTime(nextLocalDate, "00:00")?.getTime()
      : undefined;

    if (dayStartsAt === undefined || dayEndsAt === undefined) return [];

    const dayAvailability = availability.filter(
      (interval) => interval.startsAt < dayEndsAt && interval.endsAt > dayStartsAt,
    );
    const dayBookedBlocks = bookedBlocks.filter(
      (interval) => interval.startsAt < dayEndsAt && interval.endsAt > dayStartsAt,
    );
    const active = shouldApplyAutoLunch({
      localDate,
      availability: dayAvailability,
      bookedBlocks: dayBookedBlocks,
      globalAutoLunchEnabled: scheduleOptimization.globalAutoLunchEnabled,
      dayLunchMode: scheduleOptimization.dayLunchModes[localDate] ?? "AUTO",
    });

    return active
      ? generateLunchCandidates({ localDate, availability: dayAvailability })
        .map((candidate) => new Date(candidate.endsAt).toISOString())
      : [];
  });
}

export function filterTimeOptionsForAutoLunch(
  options: TimeSlotOption[],
  input: {
    serviceDurationMinutes: number;
    cleanupBlockMinutes: number;
    capacity: number;
    scheduleOptimization: PublicBookingCatalog["scheduleOptimization"];
  },
) {
  if (input.capacity !== 1) {
    return options;
  }

  const availability = input.scheduleOptimization.publishedAvailability.map((interval) => ({
    startsAt: new Date(interval.startsAt).getTime(),
    endsAt: new Date(interval.endsAt).getTime(),
  }));
  const bookedBlocks = input.scheduleOptimization.bookedIntervals.map((interval) => ({
    startsAt: new Date(interval.startsAt).getTime(),
    endsAt: new Date(interval.endsAt).getTime(),
  }));
  const dayContexts = new Map<string, {
    active: boolean;
    availability: typeof availability;
    lunchCandidates: ReturnType<typeof generateLunchCandidates>;
    bookedBlocks: typeof bookedBlocks;
  }>();

  return options.filter((option) => {
    if (option.isDisabled) {
      return true;
    }

    const startsAt = new Date(option.startsAt);
    const localDate = getPragueLocalDate(startsAt);
    let dayContext = dayContexts.get(localDate);

    if (!dayContext) {
      const nextLocalDate = getNextCalendarDate(localDate);
      const dayStartsAt = resolvePragueLocalDateTime(localDate, "00:00")?.getTime();
      const dayEndsAt = nextLocalDate
        ? resolvePragueLocalDateTime(nextLocalDate, "00:00")?.getTime()
        : undefined;
      const dayAvailability = availability.filter(
        (interval) => dayStartsAt !== undefined
          && dayEndsAt !== undefined
          && interval.startsAt < dayEndsAt
          && interval.endsAt > dayStartsAt,
      );
      const dayBookedBlocks = bookedBlocks.filter(
        (interval) => dayStartsAt !== undefined
          && dayEndsAt !== undefined
          && interval.startsAt < dayEndsAt
          && interval.endsAt > dayStartsAt,
      );
      const active = shouldApplyAutoLunch({
        localDate,
        availability: dayAvailability,
        bookedBlocks: dayBookedBlocks,
        globalAutoLunchEnabled: input.scheduleOptimization.globalAutoLunchEnabled,
        dayLunchMode: input.scheduleOptimization.dayLunchModes[localDate] ?? "AUTO",
      });
      dayContext = {
        active,
        availability: dayAvailability,
        lunchCandidates: generateLunchCandidates({ localDate, availability: dayAvailability }),
        bookedBlocks: dayBookedBlocks,
      };
      dayContexts.set(localDate, dayContext);
    }

    return canPreserveAutoLunch({
      ...dayContext,
      hypotheticalBlock: {
        startsAt: startsAt.getTime(),
        endsAt: startsAt.getTime()
          + (input.serviceDurationMinutes + input.cleanupBlockMinutes) * 60_000,
      },
    }).feasible;
  });
}

export function groupSlotsByDayPeriod(slots: TimeSlotOption[]): TimeSlotGroupData[] {
  const sortedSlots = [...slots].sort((left, right) => getSlotStartTime(left.startsAt) - getSlotStartTime(right.startsAt));

  if (sortedSlots.length === 0) {
    return [];
  }

  const grouped = new Map<DayPeriodKey, TimeSlotOption[]>();

  for (const slot of sortedSlots) {
    const period = getDayPeriod(slot.startsAt);
    const current = grouped.get(period) ?? [];
    current.push(slot);
    grouped.set(period, current);
  }

  const orderedPeriods = ["morning", "lateMorning", "afternoon", "evening"] as const satisfies readonly DayPeriodKey[];

  const orderedGroups: TimeSlotGroupData[] = orderedPeriods
    .flatMap((period) => {
      const periodSlots = grouped.get(period);

      if (!periodSlots || periodSlots.length === 0) {
        return [];
      }

      return [{
        key: period,
        label: getDayPeriodLabel(period),
        slots: periodSlots,
      }];
    });

  if (orderedGroups.length <= 1) {
    return [
      {
        key: "all-day",
        label: null,
        slots: sortedSlots,
      },
    ];
  }

  return orderedGroups;
}
