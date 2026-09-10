import assert from "node:assert/strict";
import test from "node:test";

import { AvailabilitySlotServiceRestrictionMode } from "@/generated/prisma/browser";
import { resolvePragueLocalDateTime } from "./booking-local-time";
import {
  buildSlotTimeOptions,
  filterTimeOptionsForAutoLunch,
  getAutoLunchBoundaryStartCandidates,
  type TimeSlotOption,
} from "./booking-time-slots";
import { shouldApplyAutoLunch } from "./booking-schedule-optimization";

const localDate = "2026-07-15";

function iso(time: string) {
  const value = resolvePragueLocalDateTime(localDate, time);
  assert.ok(value);
  return value.toISOString();
}

function option(start: string, serviceDurationMinutes: number): TimeSlotOption {
  const startsAt = iso(start);
  return {
    key: startsAt,
    slotId: "slot-1",
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + serviceDurationMinutes * 60_000).toISOString(),
    publicNote: null,
    isDisabled: false,
  };
}

function context(input?: {
  availabilityStart?: string;
  availabilityEnd?: string;
  availability?: Array<{ start: string; end: string }>;
  globalAutoLunchEnabled?: boolean;
  dayLunchMode?: "AUTO" | "OFF";
  bookedIntervals?: Array<{ start: string; end: string }>;
}): Parameters<typeof filterTimeOptionsForAutoLunch>[1]["scheduleOptimization"] {
  return {
    globalAutoLunchEnabled: input?.globalAutoLunchEnabled ?? true,
    dayLunchModes: input?.dayLunchMode ? { [localDate]: input.dayLunchMode } : {},
    publishedAvailability: input?.availability?.map((interval) => ({
      startsAt: iso(interval.start),
      endsAt: iso(interval.end),
    })) ?? [{
      startsAt: iso(input?.availabilityStart ?? "09:00"),
      endsAt: iso(input?.availabilityEnd ?? "17:00"),
    }],
    bookedIntervals: (input?.bookedIntervals ?? []).map((interval) => ({
      startsAt: iso(interval.start),
      endsAt: iso(interval.end),
    })),
  };
}

function filter(
  candidate: TimeSlotOption,
  scheduleOptimization = context(),
  cleanupBlockMinutes = 0,
) {
  return filterTimeOptionsForAutoLunch([candidate], {
    serviceDurationMinutes:
      (new Date(candidate.endsAt).getTime() - new Date(candidate.startsAt).getTime()) / 60_000,
    cleanupBlockMinutes,
    capacity: 1,
    scheduleOptimization,
  });
}

test("neaktivní lunch policy zachová původní selectable termíny", () => {
  const candidate = option("11:00", 165);
  assert.deepEqual(filter(candidate, context({ globalAutoLunchEnabled: false })), [candidate]);
});

test("rezervace, která pouze přesune oběd, zůstane selectable", () => {
  const candidate = option("11:00", 60);
  assert.deepEqual(filter(candidate), [candidate]);
});

test("rezervace ponechávající přesně jeden oběd zůstane selectable", () => {
  const candidate = option("11:00", 120);
  assert.deepEqual(filter(candidate), [candidate]);
});

test("rezervace odstraňující poslední možnost oběda není selectable", () => {
  assert.deepEqual(filter(option("11:00", 165)), []);
});

test("cleanup odstraňující poslední možnost oběda není selectable", () => {
  assert.deepEqual(filter(option("10:30", 30), context(), 165), []);
});

test("krátká směna lunch constraint nepoužije", () => {
  const candidate = option("11:00", 165);
  assert.deepEqual(filter(candidate, context({ availabilityEnd: "13:00" })), [candidate]);
});

test("po automatickém obědě nabídne první bezpečný čtvrthodinový začátek", () => {
  const scheduleOptimization = context({
    availabilityStart: "08:30",
    bookedIntervals: [{ start: "08:30", end: "12:30" }],
  });
  const autoLunchBoundaryStartCandidates = getAutoLunchBoundaryStartCandidates(scheduleOptimization);
  const options = buildSlotTimeOptions({
    id: "slot-after-lunch",
    startsAt: iso("08:30"),
    endsAt: iso("17:00"),
    publicNote: null,
    capacity: 1,
    serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.ANY,
    allowedServiceIds: [],
    bookedIntervals: [{ startsAt: iso("08:30"), endsAt: iso("12:30") }],
  }, 60, 0, autoLunchBoundaryStartCandidates);
  const available = filterTimeOptionsForAutoLunch(options, {
    serviceDurationMinutes: 60,
    cleanupBlockMinutes: 0,
    capacity: 1,
    scheduleOptimization,
  });

  assert.ok(autoLunchBoundaryStartCandidates.includes(iso("13:15")));
  assert.ok(available.some((candidate) => candidate.startsAt === iso("13:15")));
});

test("full-day context započítá minulou část směny a shoduje se s denní aktivací serverové logiky", () => {
  const candidate = option("11:00", 165);
  const availability = [
    { start: "06:00", end: "09:00" },
    { start: "09:30", end: "14:00" },
  ];
  const scheduleOptimization = context({ availability });
  const dayAvailability = scheduleOptimization.publishedAvailability.map((interval) => ({
    startsAt: new Date(interval.startsAt).getTime(),
    endsAt: new Date(interval.endsAt).getTime(),
  }));

  assert.equal(shouldApplyAutoLunch({
    localDate,
    availability: dayAvailability,
    globalAutoLunchEnabled: true,
    dayLunchMode: "AUTO",
  }), true);
  assert.deepEqual(filter(candidate, context({ availabilityStart: "09:30", availabilityEnd: "14:00" })), [candidate]);
  assert.deepEqual(filter(candidate, scheduleOptimization), []);
});

test("full-day context odfiltruje termín blokující poslední oběd", () => {
  const candidate = option("11:00", 165);
  const windowedContext = context({ availabilityStart: "09:30", availabilityEnd: "14:00" });
  const fullDayContext = context({
    availability: [
      { start: "06:00", end: "09:00" },
      { start: "09:30", end: "14:00" },
    ],
  });

  assert.deepEqual(filter(candidate, windowedContext), [candidate]);
  assert.deepEqual(filter(candidate, fullDayContext), []);
});

test("full-day context krátkého dne nezačne lunch constraint aplikovat", () => {
  const candidate = option("11:00", 90);
  const scheduleOptimization = context({
    availability: [
      { start: "06:00", end: "09:00" },
      { start: "09:30", end: "12:30" },
    ],
  });

  assert.equal(shouldApplyAutoLunch({
    localDate,
    availability: scheduleOptimization.publishedAvailability.map((interval) => ({
      startsAt: new Date(interval.startsAt).getTime(),
      endsAt: new Date(interval.endsAt).getTime(),
    })),
    globalAutoLunchEnabled: true,
    dayLunchMode: "AUTO",
  }), false);
  assert.deepEqual(filter(candidate, scheduleOptimization), [candidate]);
});

test("full-day context se mezi pražskými dny nemíchá", () => {
  const secondLocalDate = "2026-07-16";
  const secondIso = (time: string) => {
    const value = resolvePragueLocalDateTime(secondLocalDate, time);
    assert.ok(value);
    return value.toISOString();
  };
  const firstCandidate = option("11:00", 165);
  const secondStartsAt = secondIso("10:00");
  const secondCandidate: TimeSlotOption = {
    key: secondStartsAt,
    slotId: "slot-2",
    startsAt: secondStartsAt,
    endsAt: secondIso("11:00"),
    publicNote: null,
    isDisabled: false,
  };
  const scheduleOptimization = {
    globalAutoLunchEnabled: true,
    dayLunchModes: {},
    publishedAvailability: [
      { startsAt: iso("06:00"), endsAt: iso("09:00") },
      { startsAt: iso("09:30"), endsAt: iso("14:00") },
      { startsAt: secondIso("06:00"), endsAt: secondIso("09:00") },
      { startsAt: secondIso("09:30"), endsAt: secondIso("12:30") },
    ],
    bookedIntervals: [
      { startsAt: iso("08:30"), endsAt: iso("11:00") },
      { startsAt: secondIso("11:00"), endsAt: secondIso("11:30") },
    ],
  } satisfies Parameters<typeof filterTimeOptionsForAutoLunch>[1]["scheduleOptimization"];

  assert.deepEqual(
    filterTimeOptionsForAutoLunch([firstCandidate, secondCandidate], {
      serviceDurationMinutes: 165,
      cleanupBlockMinutes: 0,
      capacity: 1,
      scheduleOptimization,
    }),
    [secondCandidate],
  );
});

test("rezervace v archivovaných slotech aktivují ochranu oběda ve zbývající publikované dostupnosti", () => {
  const candidate = option("11:45", 75);
  const scheduleOptimization = context({
    availabilityStart: "11:15",
    availabilityEnd: "13:00",
    bookedIntervals: [
      { start: "08:30", end: "11:45" },
      { start: "13:00", end: "15:30" },
      { start: "15:30", end: "17:15" },
    ],
  });

  assert.deepEqual(filter(candidate, scheduleOptimization), []);
});

test("global OFF a day OFF lunch constraint nepoužijí", () => {
  const candidate = option("11:00", 165);
  assert.deepEqual(filter(candidate, context({ globalAutoLunchEnabled: false })), [candidate]);
  assert.deepEqual(filter(candidate, context({ dayLunchMode: "OFF" })), [candidate]);
});

test("capacity vyšší než jedna použije nezměněný chronologický fallback", () => {
  const candidate = option("11:00", 165);
  assert.deepEqual(filterTimeOptionsForAutoLunch([candidate], {
    serviceDurationMinutes: 165,
    cleanupBlockMinutes: 0,
    capacity: 2,
    scheduleOptimization: context(),
  }), [candidate]);
});

test("filtrování zachová chronologické pořadí a předem disabled možnosti", () => {
  const early = option("09:00", 60);
  const blocked = { ...option("11:00", 165), isDisabled: true };
  const late = option("14:00", 60);
  assert.deepEqual(
    filterTimeOptionsForAutoLunch([early, blocked, late], {
      serviceDurationMinutes: 60,
      cleanupBlockMinutes: 0,
      capacity: 1,
      scheduleOptimization: context(),
    }),
    [early, blocked, late],
  );
});
