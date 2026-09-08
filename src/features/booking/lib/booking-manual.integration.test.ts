import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  AvailabilitySlotStatus,
  BookingSource,
  BookingStatus,
} from "@/generated/prisma/browser";
import { getNextCalendarDate, getPragueLocalDate, resolvePragueLocalDateTime } from "@/features/booking/lib/booking-local-time";

process.env.NEXT_PUBLIC_APP_NAME ??= "PP Studio";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.ADMIN_OWNER_PASSWORD ??= "change-me-owner";
process.env.ADMIN_STAFF_EMAIL ??= "staff@example.com";
process.env.ADMIN_STAFF_PASSWORD ??= "change-me-staff";
process.env.EMAIL_DELIVERY_MODE ??= "log";
process.env.PUSHOVER_ENABLED ??= "false";

const dbTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function loadModules() {
  const [{ prisma }, bookingModule, adminBookingModule] = await Promise.all([
    import("@/lib/prisma"),
    import("./booking-public"),
    import("@/features/admin/lib/admin-booking"),
  ]);

  return {
    prisma,
    createManualBooking: bookingModule.createManualBooking,
    PublicBookingError: bookingModule.PublicBookingError,
    publicBookingErrorCodes: bookingModule.publicBookingErrorCodes,
    applyAdminBookingStatusChange: adminBookingModule.applyAdminBookingStatusChange,
  };
}

async function findIsolatedManualWindow(
  prisma: Awaited<ReturnType<typeof loadModules>>["prisma"],
  seed: string,
  durationMinutes: number,
) {
  const daySeed = Number.parseInt(seed.slice(0, 4), 16);
  const hourSeed = Number.parseInt(seed.slice(4, 6), 16);
  const minuteSeed = Number.parseInt(seed.slice(6, 8), 16);
  const hourCandidates = [18, 19, 20, 21].map((hour, index, list) => list[(index + hourSeed) % list.length] ?? hour);
  const minuteCandidates = [0, 15, 30, 45].map(
    (minute, index, list) => list[(index + minuteSeed) % list.length] ?? minute,
  );

  for (let dayStep = 0; dayStep < 30; dayStep += 1) {
    const dayOffset = 14 + ((daySeed + dayStep) % 30);

    for (const hour of hourCandidates) {
      for (const minute of minuteCandidates) {
        const startsAt = new Date();
        startsAt.setUTCSeconds(0, 0);
        startsAt.setUTCDate(startsAt.getUTCDate() + dayOffset);
        startsAt.setUTCHours(hour, minute, 0, 0);
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
        const localDate = getPragueLocalDate(startsAt);
        const nextLocalDate = getNextCalendarDate(localDate);
        const dayStartsAt = resolvePragueLocalDateTime(localDate, "00:00");
        const dayEndsAt = nextLocalDate ? resolvePragueLocalDateTime(nextLocalDate, "00:00") : null;

        if (!dayStartsAt || !dayEndsAt) continue;

        const [sameDaySlots, sameDayBookings] = await Promise.all([
          prisma.availabilitySlot.count({
            where: {
              startsAt: { lt: dayEndsAt },
              endsAt: { gt: dayStartsAt },
            },
          }),
          prisma.booking.count({
            where: {
              status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
              scheduledStartsAt: { lt: dayEndsAt },
              OR: [
                { blockedUntil: { gt: dayStartsAt } },
                { blockedUntil: null, scheduledEndsAt: { gt: dayStartsAt } },
              ],
            },
          }),
        ]);

        if (sameDaySlots === 0 && sameDayBookings === 0) {
          return { startsAt, endsAt };
        }
      }
    }
  }

  throw new Error("Nepodařilo se najít izolované okno pro ruční booking integrační test.");
}

function buildUniquePhone(seed: string) {
  const normalizedSeed = seed.replace(/[^a-f0-9]/gi, "").slice(0, 12) || "1";
  const suffix = (Number.parseInt(normalizedSeed, 16) % 100000000).toString().padStart(8, "0");
  return `+4207${suffix}`;
}

async function cleanupManualOverlapFixture(
  prisma: Awaited<ReturnType<typeof loadModules>>["prisma"],
  serviceId: string,
  categoryId: string,
  slotIds: string[],
  startsAt: Date,
  endsAt: Date,
) {
  await prisma.bookingActionToken.deleteMany({ where: { booking: { serviceId } } });
  await prisma.emailLog.deleteMany({ where: { booking: { serviceId } } });
  await prisma.bookingStatusHistory.deleteMany({ where: { booking: { serviceId } } });
  await prisma.booking.deleteMany({ where: { serviceId } });
  await prisma.availabilitySlot.deleteMany({
    where: {
      OR: [
        { id: { in: slotIds } },
        {
          startsAt: { gte: startsAt },
          endsAt: { lte: endsAt },
        },
      ],
    },
  });
  await prisma.service.delete({ where: { id: serviceId } });
  await prisma.serviceCategory.delete({ where: { id: categoryId } });
}

async function findActiveSlotsInRange(
  prisma: Awaited<ReturnType<typeof loadModules>>["prisma"],
  startsAt: Date,
  endsAt: Date,
) {
  return prisma.availabilitySlot.findMany({
    where: {
      status: {
        in: [AvailabilitySlotStatus.DRAFT, AvailabilitySlotStatus.PUBLISHED],
      },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    orderBy: { startsAt: "asc" },
    select: {
      startsAt: true,
      endsAt: true,
      status: true,
    },
  });
}

async function createManualAvailabilityFixture(
  prisma: Awaited<ReturnType<typeof loadModules>>["prisma"],
  suffix: string,
  slotDefinitions: Array<{
    startsAfterMinutes: number;
    endsAfterMinutes: number;
    internalNote?: string;
  }>,
  serviceDurationMinutes = 60,
) {
  const requiredMinutes = Math.max(...slotDefinitions.map((slot) => slot.endsAfterMinutes), serviceDurationMinutes) + 60;
  const { startsAt } = await findIsolatedManualWindow(prisma, suffix, requiredMinutes);
  const category = await prisma.serviceCategory.create({
    data: {
      name: `Manual overlap category ${suffix}`,
      slug: `manual-overlap-category-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });
  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Manual overlap service ${suffix}`,
      slug: `manual-overlap-service-${suffix}`,
      durationMinutes: serviceDurationMinutes,
      priceFromCzk: 1200,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });
  const slotIds: string[] = [];

  for (const definition of slotDefinitions) {
    const slot = await prisma.availabilitySlot.create({
      data: {
        startsAt: new Date(startsAt.getTime() + definition.startsAfterMinutes * 60_000),
        endsAt: new Date(startsAt.getTime() + definition.endsAfterMinutes * 60_000),
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        internalNote: definition.internalNote,
        publishedAt: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    slotIds.push(slot.id);
  }

  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + requiredMinutes * 60_000),
    serviceId: service.id,
    categoryId: category.id,
    slotIds,
  };
}

function assertNoActiveSlotOverlap(
  slots: Array<{ startsAt: Date; endsAt: Date }>,
) {
  for (const [index, slot] of slots.entries()) {
    for (const otherSlot of slots.slice(index + 1)) {
      assert.equal(
        slot.startsAt < otherSlot.endsAt && slot.endsAt > otherSlot.startsAt,
        false,
      );
    }
  }
}

dbTest("createManualBooking rejects stale slot-mode booking instead of silently creating manual override", async () => {
  const {
    prisma,
    createManualBooking,
    PublicBookingError,
    publicBookingErrorCodes,
  } = await loadModules();

  const suffix = randomUUID().slice(0, 8);
  const phone = buildUniquePhone(suffix);
  const { startsAt: slotStartsAt, endsAt: slotEndsAt } = await findIsolatedManualWindow(prisma, suffix, 60);
  const startsAt = new Date(slotStartsAt.getTime() + 30 * 60 * 1000);

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Manual booking category ${suffix}`,
      slug: `manual-booking-category-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Manual booking service ${suffix}`,
      slug: `manual-booking-service-${suffix}`,
      durationMinutes: 60,
      priceFromCzk: 1200,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });

  const slot = await prisma.availabilitySlot.create({
    data: {
      startsAt: slotStartsAt,
      endsAt: slotEndsAt,
      status: AvailabilitySlotStatus.PUBLISHED,
      capacity: 1,
      serviceRestrictionMode: "ANY",
      publishedAt: new Date(slotStartsAt.getTime() - 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  try {
    await assert.rejects(
      createManualBooking({
        serviceId: service.id,
        slotId: slot.id,
        allowManualOverride: false,
        startsAt: startsAt.toISOString(),
        fullName: `Klientka ${suffix}`,
        email: `manual-slot-${suffix}@example.com`,
        phone,
        source: BookingSource.PHONE,
        status: BookingStatus.CONFIRMED,
        actorUserId: null,
        sendClientEmail: false,
        includeCalendarAttachment: false,
      }),
      (error: unknown) => {
        assert.ok(error instanceof PublicBookingError);
        assert.equal(error.code, publicBookingErrorCodes.slotTooShort);
        return true;
      },
    );

    const bookings = await prisma.booking.count({
      where: {
        serviceId: service.id,
      },
    });

    assert.equal(bookings, 0);
  } finally {
    await prisma.bookingActionToken.deleteMany({
      where: {
        booking: {
          serviceId: service.id,
        },
      },
    });
    await prisma.emailLog.deleteMany({
      where: {
        booking: {
          serviceId: service.id,
        },
      },
    });
    await prisma.bookingStatusHistory.deleteMany({
      where: {
        booking: {
          serviceId: service.id,
        },
      },
    });
    await prisma.booking.deleteMany({
      where: {
        serviceId: service.id,
      },
    });
    await prisma.availabilitySlot.deleteMany({
      where: {
        id: slot.id,
      },
    });
    await prisma.service.deleteMany({
      where: {
        id: service.id,
      },
    });
    await prisma.serviceCategory.deleteMany({
      where: {
        id: category.id,
      },
    });
  }
});

dbTest("createManualBooking rejects a second overlapping booking in the same slot", async () => {
  const {
    prisma,
    createManualBooking,
    PublicBookingError,
    publicBookingErrorCodes,
  } = await loadModules();

  const suffix = randomUUID().slice(0, 8);
  const { startsAt: slotStartsAt, endsAt: slotEndsAt } = await findIsolatedManualWindow(prisma, suffix, 60);

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Single capacity category ${suffix}`,
      slug: `single-capacity-category-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Single capacity service ${suffix}`,
      slug: `single-capacity-service-${suffix}`,
      durationMinutes: 30,
      priceFromCzk: 1200,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });

  const slot = await prisma.availabilitySlot.create({
    data: {
      startsAt: slotStartsAt,
      endsAt: slotEndsAt,
      status: AvailabilitySlotStatus.PUBLISHED,
      capacity: 1,
      serviceRestrictionMode: "ANY",
      publishedAt: new Date(slotStartsAt.getTime() - 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  try {
    await createManualBooking({
      serviceId: service.id,
      slotId: slot.id,
      allowManualOverride: false,
      startsAt: slotStartsAt.toISOString(),
      fullName: `První klientka ${suffix}`,
      email: `single-capacity-first-${suffix}@example.com`,
      phone: buildUniquePhone(`${suffix}1`),
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });

    await assert.rejects(
      createManualBooking({
        serviceId: service.id,
        slotId: slot.id,
        allowManualOverride: false,
        startsAt: slotStartsAt.toISOString(),
        fullName: `Druhá klientka ${suffix}`,
        email: `single-capacity-second-${suffix}@example.com`,
        phone: buildUniquePhone(`${suffix}2`),
        source: BookingSource.PHONE,
        status: BookingStatus.CONFIRMED,
        actorUserId: null,
        sendClientEmail: false,
        includeCalendarAttachment: false,
      }),
      (error: unknown) => {
        assert.ok(error instanceof PublicBookingError);
        assert.equal(error.code, publicBookingErrorCodes.slotUnavailable);
        return true;
      },
    );
  } finally {
    await prisma.bookingActionToken.deleteMany({
      where: {
        booking: {
          serviceId: service.id,
        },
      },
    });
    await prisma.emailLog.deleteMany({
      where: {
        booking: {
          serviceId: service.id,
        },
      },
    });
    await prisma.bookingStatusHistory.deleteMany({
      where: {
        booking: {
          serviceId: service.id,
        },
      },
    });
    await prisma.booking.deleteMany({
      where: {
        serviceId: service.id,
      },
    });
    await prisma.availabilitySlot.deleteMany({
      where: {
        startsAt: {
          gte: slotStartsAt,
          lt: slotEndsAt,
        },
      },
    });
    await prisma.service.delete({
      where: {
        id: service.id,
      },
    });
    await prisma.serviceCategory.delete({
      where: {
        id: category.id,
      },
    });
  }
});

dbTest("createManualBooking still allows explicit manual override without slot selection", async () => {
  const { prisma, createManualBooking } = await loadModules();

  const suffix = randomUUID().slice(0, 8);
  const phone = buildUniquePhone(suffix);
  const { startsAt } = await findIsolatedManualWindow(prisma, suffix, 60);

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Manual override category ${suffix}`,
      slug: `manual-override-category-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Manual override service ${suffix}`,
      slug: `manual-override-service-${suffix}`,
      durationMinutes: 60,
      priceFromCzk: 1200,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });

  let bookingId: string | null = null;
  let createdSlotId: string | null = null;

  try {
    const result = await createManualBooking({
      serviceId: service.id,
      allowManualOverride: true,
      startsAt: startsAt.toISOString(),
      fullName: `Klientka override ${suffix}`,
      email: `manual-override-${suffix}@example.com`,
      phone,
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });

    bookingId = result.bookingId;
    assert.equal(result.manualOverride, true);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: result.bookingId },
      select: {
        manualOverride: true,
        isManual: true,
        slotId: true,
        slot: {
          select: {
            status: true,
          },
        },
      },
    });

    assert.equal(booking.manualOverride, true);
    assert.equal(booking.isManual, true);
    createdSlotId = booking.slotId;
    assert.equal(booking.slot.status, AvailabilitySlotStatus.DRAFT);
  } finally {
    if (bookingId) {
      await prisma.bookingActionToken.deleteMany({
        where: { bookingId },
      });
      await prisma.emailLog.deleteMany({
        where: { bookingId },
      });
      await prisma.bookingStatusHistory.deleteMany({
        where: { bookingId },
      });
      await prisma.booking.deleteMany({
        where: { id: bookingId },
      });
    }
    if (createdSlotId) {
      await prisma.availabilitySlot.deleteMany({
        where: {
          id: createdSlotId,
        },
      });
    }
    await prisma.service.deleteMany({
      where: {
        id: service.id,
      },
    });
    await prisma.serviceCategory.deleteMany({
      where: {
        id: category.id,
      },
    });
  }
});

dbTest("createManualBooking ořízne částečný overlap zleva a cancellation obnoví dostupnost", async () => {
  const { prisma, createManualBooking, applyAdminBookingStatusChange } = await loadModules();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createManualAvailabilityFixture(prisma, suffix, [
    { startsAfterMinutes: 0, endsAfterMinutes: 60 },
  ]);
  const requestedStartsAt = new Date(fixture.startsAt.getTime() + 30 * 60_000);
  const requestedEndsAt = new Date(fixture.startsAt.getTime() + 90 * 60_000);
  let bookingId: string | null = null;

  try {
    const result = await createManualBooking({
      serviceId: fixture.serviceId,
      allowManualOverride: true,
      startsAt: requestedStartsAt.toISOString(),
      fullName: `Partial overlap ${suffix}`,
      email: `partial-overlap-${suffix}@example.com`,
      phone: buildUniquePhone(suffix),
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });
    bookingId = result.bookingId;
    assert.equal(result.manualOverride, true);

    const activeSlots = await findActiveSlotsInRange(prisma, fixture.startsAt, requestedEndsAt);
    assert.deepEqual(activeSlots.map((slot) => [
      slot.startsAt.toISOString(),
      slot.endsAt.toISOString(),
      slot.status,
    ]), [
      [fixture.startsAt.toISOString(), requestedStartsAt.toISOString(), AvailabilitySlotStatus.PUBLISHED],
      [requestedStartsAt.toISOString(), requestedEndsAt.toISOString(), AvailabilitySlotStatus.DRAFT],
    ]);
    assertNoActiveSlotOverlap(activeSlots);

    const cancellation = await applyAdminBookingStatusChange({
      bookingId,
      targetStatus: BookingStatus.CANCELLED,
      actorUserId: null,
      notifyClient: true,
      reason: "Partial overlap regression",
    });
    assert.equal(cancellation.status, "success");

    const restoredSlots = await findActiveSlotsInRange(prisma, fixture.startsAt, requestedEndsAt);
    assert.equal(restoredSlots.some((slot) => (
      slot.status === AvailabilitySlotStatus.PUBLISHED
      && slot.startsAt <= fixture.startsAt
      && slot.endsAt >= new Date(fixture.startsAt.getTime() + 60 * 60_000)
    )), true);
    assert.equal(restoredSlots.some((slot) => slot.status === AvailabilitySlotStatus.DRAFT), false);
    assertNoActiveSlotOverlap(restoredSlots);
  } finally {
    await cleanupManualOverlapFixture(
      prisma,
      fixture.serviceId,
      fixture.categoryId,
      fixture.slotIds,
      fixture.startsAt,
      fixture.endsAt,
    );
  }
});

dbTest("createManualBooking ořízne částečný overlap zprava", async () => {
  const { prisma, createManualBooking } = await loadModules();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createManualAvailabilityFixture(prisma, suffix, [
    { startsAfterMinutes: 60, endsAfterMinutes: 120 },
  ]);
  const requestedStartsAt = new Date(fixture.startsAt.getTime() + 30 * 60_000);
  const requestedEndsAt = new Date(fixture.startsAt.getTime() + 90 * 60_000);

  try {
    const result = await createManualBooking({
      serviceId: fixture.serviceId,
      allowManualOverride: true,
      startsAt: requestedStartsAt.toISOString(),
      fullName: `Right overlap ${suffix}`,
      email: `right-overlap-${suffix}@example.com`,
      phone: buildUniquePhone(suffix),
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });
    assert.equal(result.manualOverride, true);

    const activeSlots = await findActiveSlotsInRange(prisma, requestedStartsAt, fixture.endsAt);
    assert.deepEqual(activeSlots.map((slot) => [
      slot.startsAt.toISOString(),
      slot.endsAt.toISOString(),
      slot.status,
    ]), [
      [requestedStartsAt.toISOString(), requestedEndsAt.toISOString(), AvailabilitySlotStatus.DRAFT],
      [requestedEndsAt.toISOString(), new Date(fixture.startsAt.getTime() + 120 * 60_000).toISOString(), AvailabilitySlotStatus.PUBLISHED],
    ]);
    assertNoActiveSlotOverlap(activeSlots);
  } finally {
    await cleanupManualOverlapFixture(
      prisma,
      fixture.serviceId,
      fixture.categoryId,
      fixture.slotIds,
      fixture.startsAt,
      fixture.endsAt,
    );
  }
});

dbTest("createManualBooking přes více editable PUBLISHED slotů vytvoří canonical hrany bez overlapu", async () => {
  const { prisma, createManualBooking } = await loadModules();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createManualAvailabilityFixture(prisma, suffix, [
    { startsAfterMinutes: 0, endsAfterMinutes: 60 },
    { startsAfterMinutes: 60, endsAfterMinutes: 120 },
  ], 120);
  const requestedStartsAt = new Date(fixture.startsAt.getTime() + 30 * 60_000);
  const requestedEndsAt = new Date(fixture.startsAt.getTime() + 150 * 60_000);

  try {
    const result = await createManualBooking({
      serviceId: fixture.serviceId,
      allowManualOverride: true,
      startsAt: requestedStartsAt.toISOString(),
      fullName: `Multi overlap ${suffix}`,
      email: `multi-overlap-${suffix}@example.com`,
      phone: buildUniquePhone(suffix),
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });
    assert.equal(result.manualOverride, true);

    const activeSlots = await findActiveSlotsInRange(prisma, fixture.startsAt, requestedEndsAt);
    assert.deepEqual(activeSlots.map((slot) => [
      slot.startsAt.toISOString(),
      slot.endsAt.toISOString(),
      slot.status,
    ]), [
      [fixture.startsAt.toISOString(), requestedStartsAt.toISOString(), AvailabilitySlotStatus.PUBLISHED],
      [requestedStartsAt.toISOString(), requestedEndsAt.toISOString(), AvailabilitySlotStatus.DRAFT],
    ]);
    assertNoActiveSlotOverlap(activeSlots);
  } finally {
    await cleanupManualOverlapFixture(
      prisma,
      fixture.serviceId,
      fixture.categoryId,
      fixture.slotIds,
      fixture.startsAt,
      fixture.endsAt,
    );
  }
});

dbTest("createManualBooking neořízne protected PUBLISHED slot a bezpečně odmítne override", async () => {
  const { prisma, createManualBooking, PublicBookingError, publicBookingErrorCodes } = await loadModules();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createManualAvailabilityFixture(prisma, suffix, [
    { startsAfterMinutes: 0, endsAfterMinutes: 60, internalNote: "Protected interval" },
  ]);
  const requestedStartsAt = new Date(fixture.startsAt.getTime() + 30 * 60_000);

  try {
    await assert.rejects(
      createManualBooking({
        serviceId: fixture.serviceId,
        allowManualOverride: true,
        startsAt: requestedStartsAt.toISOString(),
        fullName: `Protected overlap ${suffix}`,
        email: `protected-overlap-${suffix}@example.com`,
        phone: buildUniquePhone(suffix),
        source: BookingSource.PHONE,
        status: BookingStatus.CONFIRMED,
        actorUserId: null,
        sendClientEmail: false,
        includeCalendarAttachment: false,
      }),
      (error: unknown) => {
        assert.ok(error instanceof PublicBookingError);
        assert.equal(error.code, publicBookingErrorCodes.bookingConflict);
        assert.equal(error.message, "Vybraný termín zasahuje do interně blokovaného času.");
        return true;
      },
    );

    assert.equal(await prisma.booking.count({ where: { serviceId: fixture.serviceId } }), 0);
    const protectedSlot = await prisma.availabilitySlot.findFirstOrThrow({
      where: { id: fixture.slotIds[0] },
      select: { status: true, startsAt: true, endsAt: true, internalNote: true },
    });
    assert.equal(protectedSlot.status, AvailabilitySlotStatus.PUBLISHED);
    assert.equal(protectedSlot.startsAt.toISOString(), fixture.startsAt.toISOString());
    assert.equal(protectedSlot.endsAt.toISOString(), new Date(fixture.startsAt.getTime() + 60 * 60_000).toISOString());
    assert.equal(protectedSlot.internalNote, "Protected interval");
  } finally {
    await cleanupManualOverlapFixture(
      prisma,
      fixture.serviceId,
      fixture.categoryId,
      fixture.slotIds,
      fixture.startsAt,
      fixture.endsAt,
    );
  }
});

dbTest("createManualBooking zachová standardní coverage bez DRAFT override", async () => {
  const { prisma, createManualBooking } = await loadModules();
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createManualAvailabilityFixture(prisma, suffix, [
    { startsAfterMinutes: 0, endsAfterMinutes: 180 },
  ]);
  const requestedStartsAt = new Date(fixture.startsAt.getTime() + 60 * 60_000);
  const requestedEndsAt = new Date(fixture.startsAt.getTime() + 120 * 60_000);

  try {
    const result = await createManualBooking({
      serviceId: fixture.serviceId,
      allowManualOverride: true,
      startsAt: requestedStartsAt.toISOString(),
      fullName: `Covered manual ${suffix}`,
      email: `covered-manual-${suffix}@example.com`,
      phone: buildUniquePhone(suffix),
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });
    assert.equal(result.manualOverride, false);

    const activeSlots = await findActiveSlotsInRange(prisma, fixture.startsAt, fixture.endsAt);
    assert.deepEqual(activeSlots.map((slot) => [
      slot.startsAt.toISOString(),
      slot.endsAt.toISOString(),
      slot.status,
    ]), [
      [fixture.startsAt.toISOString(), requestedStartsAt.toISOString(), AvailabilitySlotStatus.PUBLISHED],
      [requestedStartsAt.toISOString(), requestedEndsAt.toISOString(), AvailabilitySlotStatus.PUBLISHED],
      [requestedEndsAt.toISOString(), new Date(fixture.startsAt.getTime() + 180 * 60_000).toISOString(), AvailabilitySlotStatus.PUBLISHED],
    ]);
    assertNoActiveSlotOverlap(activeSlots);
  } finally {
    await cleanupManualOverlapFixture(
      prisma,
      fixture.serviceId,
      fixture.categoryId,
      fixture.slotIds,
      fixture.startsAt,
      fixture.endsAt,
    );
  }
});

dbTest("createManualBooking keeps existing selected client email when manual booking form leaves it blank", async () => {
  const { prisma, createManualBooking } = await loadModules();

  const suffix = randomUUID().slice(0, 8);
  const phone = buildUniquePhone(suffix);
  const { startsAt, endsAt } = await findIsolatedManualWindow(prisma, suffix, 60);

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Selected client category ${suffix}`,
      slug: `selected-client-category-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Selected client service ${suffix}`,
      slug: `selected-client-service-${suffix}`,
      durationMinutes: 60,
      priceFromCzk: 1200,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });

  const slot = await prisma.availabilitySlot.create({
    data: {
      startsAt,
      endsAt,
      status: AvailabilitySlotStatus.PUBLISHED,
      capacity: 1,
      serviceRestrictionMode: "ANY",
      publishedAt: new Date("2027-05-01T08:00:00.000Z"),
    },
    select: { id: true },
  });

  const client = await prisma.client.create({
    data: {
      fullName: `Vybraná klientka ${suffix}`,
      email: `selected-client-${suffix}@example.com`,
      phone,
      isActive: true,
    },
    select: { id: true },
  });

  let bookingId: string | null = null;

  try {
    const result = await createManualBooking({
      serviceId: service.id,
      slotId: slot.id,
      allowManualOverride: false,
      startsAt: startsAt.toISOString(),
      selectedClientId: client.id,
      fullName: `Aktualizovaná vybraná klientka ${suffix}`,
      email: "",
      phone: buildUniquePhone(`${suffix}1`),
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });

    bookingId = result.bookingId;

    const updatedClient = await prisma.client.findUniqueOrThrow({
      where: { id: client.id },
      select: {
        fullName: true,
        email: true,
        phone: true,
      },
    });

    assert.deepEqual(updatedClient, {
      fullName: `Aktualizovaná vybraná klientka ${suffix}`,
      email: `selected-client-${suffix}@example.com`,
      phone: buildUniquePhone(`${suffix}1`),
    });
  } finally {
    if (bookingId) {
      await prisma.bookingActionToken.deleteMany({
        where: { bookingId },
      });
      await prisma.emailLog.deleteMany({
        where: { bookingId },
      });
      await prisma.bookingStatusHistory.deleteMany({
        where: { bookingId },
      });
      await prisma.booking.deleteMany({
        where: { id: bookingId },
      });
    }
    await prisma.client.deleteMany({
      where: {
        id: client.id,
      },
    });
    await prisma.availabilitySlot.deleteMany({
      where: {
        id: slot.id,
      },
    });
    await prisma.service.deleteMany({
      where: {
        id: service.id,
      },
    });
    await prisma.serviceCategory.deleteMany({
      where: {
        id: category.id,
      },
    });
  }
});

dbTest("createManualBooking creates confirmed admin reservation with service snapshot on published slot", async () => {
  const { prisma, createManualBooking } = await loadModules();

  const suffix = randomUUID().slice(0, 8);
  const phone = buildUniquePhone(suffix);
  const { startsAt, endsAt } = await findIsolatedManualWindow(prisma, suffix, 90);

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Admin snapshot category ${suffix}`,
      slug: `admin-snapshot-category-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Admin snapshot service ${suffix}`,
      slug: `admin-snapshot-service-${suffix}`,
      durationMinutes: 90,
      priceFromCzk: 1850,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });

  const slot = await prisma.availabilitySlot.create({
    data: {
      startsAt,
      endsAt,
      status: AvailabilitySlotStatus.PUBLISHED,
      capacity: 1,
      serviceRestrictionMode: "ANY",
      publishedAt: new Date("2027-05-01T08:00:00.000Z"),
    },
    select: { id: true },
  });

  let bookingId: string | null = null;

  try {
    const result = await createManualBooking({
      serviceId: service.id,
      slotId: slot.id,
      allowManualOverride: false,
      startsAt: startsAt.toISOString(),
      fullName: `Admin klientka ${suffix}`,
      email: `admin-manual-${suffix}@example.com`,
      phone,
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });

    bookingId = result.bookingId;

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: result.bookingId },
      select: {
        isManual: true,
        manualOverride: true,
        source: true,
        status: true,
        serviceNameSnapshot: true,
        serviceDurationMinutes: true,
        servicePriceFromCzk: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
      },
    });

    assert.equal(result.status, BookingStatus.CONFIRMED);
    assert.equal(result.manualOverride, false);
    assert.equal(booking.isManual, true);
    assert.equal(booking.manualOverride, false);
    assert.equal(booking.source, BookingSource.PHONE);
    assert.equal(booking.status, BookingStatus.CONFIRMED);
    assert.equal(booking.serviceNameSnapshot, `Admin snapshot service ${suffix}`);
    assert.equal(booking.serviceDurationMinutes, 90);
    assert.equal(booking.servicePriceFromCzk, 1850);
    assert.equal(booking.scheduledStartsAt.toISOString(), startsAt.toISOString());
    assert.equal(booking.scheduledEndsAt.toISOString(), endsAt.toISOString());
  } finally {
    if (bookingId) {
      await prisma.bookingActionToken.deleteMany({
        where: { bookingId },
      });
      await prisma.emailLog.deleteMany({
        where: { bookingId },
      });
      await prisma.bookingStatusHistory.deleteMany({
        where: { bookingId },
      });
      await prisma.booking.deleteMany({
        where: { id: bookingId },
      });
    }
    await prisma.client.deleteMany({
      where: {
        email: `admin-manual-${suffix}@example.com`,
      },
    });
    await prisma.availabilitySlot.deleteMany({
      where: {
        id: slot.id,
      },
    });
    await prisma.service.deleteMany({
      where: {
        id: service.id,
      },
    });
    await prisma.serviceCategory.deleteMany({
      where: {
        id: category.id,
      },
    });
  }
});
