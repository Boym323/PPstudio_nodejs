import assert from "node:assert/strict";
import test from "node:test";

import { getCellRangeBounds } from "@/features/admin/lib/admin-slots/time";
import type { PlannerDay, PlannerWeekData } from "@/features/admin/lib/admin-slots";
import { plannerWeekToFullCalendarEvents } from "./planner-lab-adapter";

function day(dateKey: string): PlannerDay {
  return {
    dateKey, isoDate: `${dateKey}T00:00:00.000Z`, label: dateKey, shortLabel: "Po", dayNumber: "1", monthLabel: "1.", monthDayLabel: "1. 1.", isToday: false, isPast: false,
    availableIntervals: [{ startCell: 2, endCell: 4, label: "07:00 - 08:00" }], lockedIntervals: [{ startCell: 8, endCell: 10, label: "10:00 - 11:00" }],
    cleanupBlocks: [{ startMinutes: 540, endMinutes: 570 }], availableBlocks: [], lockedBlocks: [], inactiveBlocks: [],
    bookings: [{ id: "booking-1", slotId: "slot-1", startCell: 4, endCell: 6, serviceStartMinutes: 480, serviceEndMinutes: 540, label: "08:00 - 09:00", blockedLabel: "08:00 - 09:00", cleanupBlockedUntilLabel: "09:30", hasCleanupBlock: true, clientName: "Eva", serviceName: "Masáž", status: "CONFIRMED" }],
    autoLunch: { mode: "AUTO", startsAt: null, endsAt: null, warning: false },
    intervals: [{ id: "locked-1", startCell: 8, endCell: 10, label: "10:00 - 11:00", status: "locked", bookingCount: 0, canEdit: false, detail: "locked" }],
    cells: { available: Array(28).fill(false), booked: Array(28).fill(false), bookedCleanup: Array(28).fill(false), completed: Array(28).fill(false), inactive: Array(28).fill(false), locked: Array(28).fill(false), past: Array(28).fill(false) },
    summary: { availableLabel: "", bookingLabel: "", note: "" },
  };
}

function week(dateKey = "2026-07-13"): PlannerWeekData {
  return { area: "owner", baseHref: "/admin/volne-terminy", title: "", subtitle: "", weekKey: dateKey, previousWeekKey: "", nextWeekKey: "", weekRangeLabel: "", todayKey: "", autoLunchEnabled: true, days: [day(dateKey)], legend: [] };
}

test("adaptér mapuje jednotlivé typy eventů se stabilními ID", () => {
  const input = week();
  const events = plannerWeekToFullCalendarEvents(input);
  assert.deepEqual(events.map((event) => event.extendedProps.type).sort(), ["availability", "booking", "cleanup", "protected"]);
  assert.deepEqual(events.map((event) => event.id), plannerWeekToFullCalendarEvents(input).map((event) => event.id));
  assert.ok(events.every((event) => event.start.endsWith("Z") && event.end.endsWith("Z")));
  assert.equal(events.find((event) => event.extendedProps.type === "availability")?.display, "background");
  assert.equal(events.find((event) => event.extendedProps.type === "availability")?.title, "Volný termín");
  assert.equal(events.find((event) => event.extendedProps.type === "cleanup")?.display, "block");
  assert.equal(events.find((event) => event.extendedProps.type === "protected")?.display, "background");
  assert.equal(events.find((event) => event.extendedProps.type === "booking")?.display, "block");
  assert.equal(events.find((event) => event.extendedProps.type === "booking")?.extendedProps.bookingId, "booking-1");
});

test("adaptér zachová dostupnost jako background event i po změně aktuálního stavu", () => {
  const input = week();
  const draft = day("2026-07-13");
  draft.availableIntervals = [{ startCell: 6, endCell: 8, label: "09:00 - 10:00" }];
  const event = plannerWeekToFullCalendarEvents(input, [draft]).find((item) => item.id.startsWith("availability:"));
  assert.equal(event?.extendedProps.type, "availability");
  assert.equal(event?.display, "background");
  assert.deepEqual([event?.extendedProps.startCell, event?.extendedProps.endCell], [6, 8]);
});

test("adaptér odliší čekající rezervaci jantarovou barvou", () => {
  const input = week();
  input.days[0].bookings[0].status = "PENDING";

  const event = plannerWeekToFullCalendarEvents(input).find((item) => item.extendedProps.bookingId === "booking-1");

  assert.equal(event?.className, "planner-lab-event--pending");
  assert.equal(event?.color, "#d6a64e");
});

test("adaptér nevykreslí chráněný interval pod úklidem", () => {
  const input = week();
  input.days[0].cleanupBlocks = [{ startMinutes: 240, endMinutes: 270 }];
  input.days[0].intervals = [{
    id: "locked-cleanup",
    startCell: 8,
    endCell: 9,
    label: "10:00 - 10:30",
    status: "locked",
    bookingCount: 0,
    canEdit: false,
    detail: "Blokováno úklidem",
  }];

  const events = plannerWeekToFullCalendarEvents(input);

  assert.equal(events.filter((event) => event.extendedProps.type === "cleanup").length, 1);
  assert.equal(events.filter((event) => event.extendedProps.type === "protected").length, 0);
});

test("adaptér neprodlužuje interní draft za čtvrthodinový konec úklidu", () => {
  const input = week();
  input.days[0].inactiveBlocks = [{ startMinutes: 645, endMinutes: 765 }];
  input.days[0].cleanupBlocks = [{ startMinutes: 735, endMinutes: 765 }];
  input.days[0].intervals = [{
    id: "draft-with-booking",
    startCell: 21,
    endCell: 26,
    label: "16:45 - 18:45",
    status: "inactive",
    bookingCount: 1,
    canEdit: false,
    detail: "Interní výjimka pro přesun rezervace",
  }];

  const protectedEvents = plannerWeekToFullCalendarEvents(input)
    .filter((event) => event.extendedProps.type === "protected");

  assert.deepEqual(protectedEvents.map((event) => [event.start, event.end]), [
    ["2026-07-13T14:45:00.000Z", "2026-07-13T16:15:00.000Z"],
  ]);
});

test("UTC intervaly zachovají Prague čas v létě, zimě i při obou DST přechodech", () => {
  assert.equal(getCellRangeBounds("2026-07-13", 0, 1).startsAt.toISOString(), "2026-07-13T04:00:00.000Z");
  assert.equal(getCellRangeBounds("2026-01-12", 0, 1).startsAt.toISOString(), "2026-01-12T05:00:00.000Z");
  assert.equal(getCellRangeBounds("2026-03-29", 0, 1).startsAt.toISOString(), "2026-03-29T04:00:00.000Z");
  assert.equal(getCellRangeBounds("2026-10-25", 0, 1).startsAt.toISOString(), "2026-10-25T05:00:00.000Z");
});

test("adaptér předá FullCalendaru 09:00 místního času po přechodu na letní čas", () => {
  const input = week("2027-03-29");
  input.days[0].availableIntervals = [{ startCell: 6, endCell: 8, label: "09:00 - 10:00" }];

  const event = plannerWeekToFullCalendarEvents(input).find((item) => item.id.startsWith("availability:"));

  assert.equal(event?.start, "2027-03-29T07:00:00.000Z");
  assert.equal(event?.end, "2027-03-29T08:00:00.000Z");
});

test("adaptér vykreslí automatický oběd přesně 45 minut bez zaokrouhlení", () => {
  const input = week();
  input.days[0].autoLunch = { mode: "AUTO", startsAt: "2026-07-13T10:15:00.000Z", endsAt: "2026-07-13T11:00:00.000Z", warning: false };
  const event = plannerWeekToFullCalendarEvents(input).find((item) => item.extendedProps.type === "lunch");
  assert.equal(event?.title, "Oběd · automaticky");
  assert.equal(event?.start, "2026-07-13T10:15:00.000Z");
  assert.equal(event?.end, "2026-07-13T11:00:00.000Z");
  assert.equal(new Date(event!.end).getTime() - new Date(event!.start).getTime(), 45 * 60_000);
  assert.equal(event?.editable, false);
  assert.equal(event?.extendedProps.editable, false);
});

test("adaptér nezobrazí oběd v režimu OFF ani při varování bez kandidáta", () => {
  const input = week();
  input.days[0].autoLunch = { mode: "OFF", startsAt: null, endsAt: null, warning: true };
  assert.equal(plannerWeekToFullCalendarEvents(input).some((item) => item.extendedProps.type === "lunch"), false);
});
