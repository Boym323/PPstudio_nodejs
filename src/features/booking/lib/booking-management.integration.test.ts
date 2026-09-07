import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { describe } from "node:test";

import { compactAdjacentEditableSlotsForBooking } from "./booking-slot-compaction";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.NEXT_PUBLIC_APP_NAME ??= "PP Studio";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.ADMIN_OWNER_PASSWORD ??= "change-me-owner";
process.env.ADMIN_STAFF_EMAIL ??= "staff@example.com";
process.env.ADMIN_STAFF_PASSWORD ??= "change-me-staff";
process.env.EMAIL_DELIVERY_MODE ??= "log";

const dbTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

type SeedContext = {
  actorUserId: string;
  categoryId: string;
  serviceId: string;
  primaryClientId: string;
  secondaryClientId: string;
  manageableBookingId: string;
  manageableBookingUpdatedAt: string;
  manageableStartAt: string;
  manageableCurrentSlotId: string;
  replacementSlotId: string;
  replacementStartAt: string;
  otherBookingId: string;
  otherManageTokenRaw: string;
  manageTokenRaw: string;
  completedManageTokenRaw: string;
  cancelledManageTokenRaw: string;
  cancelTokenRaw: string;
  secondaryCancelTokenRaw: string;
  deadlineCancelTokenRaw: string;
  noShowCancelTokenRaw: string;
  tooLateManageTokenRaw: string;
  conflictSlotId: string;
  conflictStartAt: string;
  tooLateSlotId: string;
  tooLateBookingId: string;
  tooLateStartAt: string;
  outsideWindowSlotId: string;
  outsideWindowStartAt: string;
  completedBookingId: string;
  cancelledBookingId: string;
  noShowBookingId: string;
  createdBookingIds: string[];
  createdSlotIds: string[];
  createdTokenHashes: string[];
};

async function loadModules() {
  const [{ prisma }, managementModule, cancellationModule, actionTokenModule, prismaClientModule] =
    await Promise.all([
      import("@/lib/prisma"),
      import("./booking-management"),
      import("./booking-cancellation"),
      import("./booking-action-tokens"),
      import("@/generated/prisma/browser"),
    ]);

  return {
    prisma,
    createBookingManagementApi: managementModule.createBookingManagementApi,
    getPublicBookingManagementPageState: managementModule.getPublicBookingManagementPageState,
    reschedulePublicBookingByToken: managementModule.reschedulePublicBookingByToken,
    cancelPublicBookingByToken: cancellationModule.cancelPublicBookingByToken,
    issuePublicCancellationUrlByManageToken: managementModule.issuePublicCancellationUrlByManageToken,
    buildBookingSelfServiceActionExpiry: actionTokenModule.buildBookingSelfServiceActionExpiry,
    hashBookingActionToken: actionTokenModule.hashBookingActionToken,
    BookingActionTokenType: prismaClientModule.BookingActionTokenType,
    BookingActorType: prismaClientModule.BookingActorType,
    BookingSource: prismaClientModule.BookingSource,
    BookingStatus: prismaClientModule.BookingStatus,
    EmailAudience: prismaClientModule.EmailAudience,
    EmailLogType: prismaClientModule.EmailLogType,
    AvailabilitySlotStatus: prismaClientModule.AvailabilitySlotStatus,
  };
}

function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function addDays(base: Date, days: number) {
  return addHours(base, days * 24);
}

async function findFreeStartAt(
  prisma: Awaited<ReturnType<typeof loadModules>>["prisma"],
  {
    earliest,
    latest,
    durationMinutes,
    preferredHour,
    preferredMinute,
  }: {
    earliest: Date;
    latest: Date;
    durationMinutes: number;
    preferredHour: number;
    preferredMinute: number;
  },
) {
  const candidate = new Date(earliest);
  candidate.setUTCSeconds(0, 0);

  if (
    candidate.getUTCHours() > preferredHour ||
    (candidate.getUTCHours() === preferredHour && candidate.getUTCMinutes() > preferredMinute)
  ) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  candidate.setUTCHours(preferredHour, preferredMinute, 0, 0);

  while (candidate < earliest) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  while (candidate <= latest) {
    const candidateEnd = addHours(candidate, durationMinutes / 60);
    const overlappingCount = await prisma.availabilitySlot.count({
      where: {
        startsAt: {
          lt: candidateEnd,
        },
        endsAt: {
          gt: candidate,
        },
      },
    });

    if (overlappingCount === 0) {
      return new Date(candidate);
    }

    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  throw new Error("Could not find a free availability slot window for booking-management integration test.");
}

async function createSeed() {
  const {
    prisma,
    hashBookingActionToken,
    BookingActionTokenType,
    BookingStatus,
    AvailabilitySlotStatus,
  } = await loadModules();

  const suffix = randomUUID().slice(0, 8);
  const now = new Date();
  const manageableStartAt = await findFreeStartAt(prisma, {
    earliest: addDays(now, 6),
    latest: addDays(now, 30),
    durationMinutes: 60,
    preferredHour: 2,
    preferredMinute: 11,
  });
  const manageableEndAt = addHours(manageableStartAt, 1);
  const replacementStartAt = await findFreeStartAt(prisma, {
    earliest: addDays(manageableStartAt, 2),
    latest: addDays(manageableStartAt, 20),
    durationMinutes: 60,
    preferredHour: 3,
    preferredMinute: 17,
  });
  const replacementEndAt = addHours(replacementStartAt, 1);
  const conflictStartAt = await findFreeStartAt(prisma, {
    earliest: addDays(replacementStartAt, 1),
    latest: addDays(replacementStartAt, 20),
    durationMinutes: 60,
    preferredHour: 4,
    preferredMinute: 23,
  });
  const conflictEndAt = addHours(conflictStartAt, 1);
  // Musí zůstat uvnitř 24hodinové lhůty bez ohledu na čas spuštění testu.
  const tooLateStartAt = addHours(now, 12);
  const tooLateEndAt = addHours(tooLateStartAt, 1);
  const outsideWindowStartAt = await findFreeStartAt(prisma, {
    earliest: addDays(now, 91),
    latest: addDays(now, 120),
    durationMinutes: 60,
    preferredHour: 9,
    preferredMinute: 53,
  });
  const outsideWindowEndAt = addHours(outsideWindowStartAt, 1);
  const completedStartAt = await findFreeStartAt(prisma, {
    earliest: addDays(now, 5),
    latest: addDays(now, 30),
    durationMinutes: 60,
    preferredHour: 5,
    preferredMinute: 31,
  });
  const completedEndAt = addHours(completedStartAt, 1);
  const cancelledStartAt = await findFreeStartAt(prisma, {
    earliest: addDays(now, 7),
    latest: addDays(now, 30),
    durationMinutes: 60,
    preferredHour: 6,
    preferredMinute: 37,
  });
  const cancelledEndAt = addHours(cancelledStartAt, 1);
  const noShowStartAt = await findFreeStartAt(prisma, {
    earliest: addDays(now, 4),
    latest: addDays(now, 30),
    durationMinutes: 60,
    preferredHour: 7,
    preferredMinute: 43,
  });
  const noShowEndAt = addHours(noShowStartAt, 1);
  const otherBookingStartAt = await findFreeStartAt(prisma, {
    earliest: addDays(now, 10),
    latest: addDays(now, 35),
    durationMinutes: 60,
    preferredHour: 8,
    preferredMinute: 49,
  });
  const otherBookingEndAt = addHours(otherBookingStartAt, 1);

  const actor = await prisma.adminUser.create({
    data: {
      email: `booking-manage-${suffix}@example.com`,
      name: `Booking Manage Test ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Manage category ${suffix}`,
      slug: `manage-category-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Manage service ${suffix}`,
      slug: `manage-service-${suffix}`,
      durationMinutes: 60,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });

  const [primaryClient, secondaryClient] = await Promise.all([
    prisma.client.create({
      data: {
        fullName: `Klientka Manage ${suffix}`,
        email: `client-manage-${suffix}@example.com`,
        phone: "+420777123456",
        isActive: true,
      },
      select: { id: true },
    }),
    prisma.client.create({
      data: {
        fullName: `Kolize Manage ${suffix}`,
        email: `client-collision-${suffix}@example.com`,
        phone: "+420777654321",
        isActive: true,
      },
      select: { id: true },
    }),
  ]);

  const slots = await prisma.$transaction([
    prisma.availabilitySlot.create({
      data: {
        startsAt: manageableStartAt,
        endsAt: manageableEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: replacementStartAt,
        endsAt: replacementEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: conflictStartAt,
        endsAt: conflictEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: tooLateStartAt,
        endsAt: tooLateEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: outsideWindowStartAt,
        endsAt: outsideWindowEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: completedStartAt,
        endsAt: completedEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: cancelledStartAt,
        endsAt: cancelledEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: noShowStartAt,
        endsAt: noShowEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: otherBookingStartAt,
        endsAt: otherBookingEndAt,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: "ANY",
        publishedAt: addDays(now, -1),
        createdByUserId: actor.id,
      },
      select: { id: true },
    }),
  ]);

  const [
    manageableBooking,
    otherBooking,
    conflictingBooking,
    tooLateBooking,
    completedBooking,
    cancelledBooking,
    noShowBooking,
  ] = await prisma.$transaction([
    prisma.booking.create({
      data: {
        clientId: primaryClient.id,
        slotId: slots[0].id,
        serviceId: service.id,
        source: "WEB",
        status: BookingStatus.CONFIRMED,
        clientNameSnapshot: `Klientka Manage ${suffix}`,
        clientEmailSnapshot: `client-manage-${suffix}@example.com`,
        clientPhoneSnapshot: "+420777123456",
        serviceNameSnapshot: `Manage service ${suffix}`,
        serviceDurationMinutes: 60,
        scheduledStartsAt: manageableStartAt,
        scheduledEndsAt: manageableEndAt,
        confirmedAt: addDays(now, -1),
        reminder24hQueuedAt: addHours(manageableStartAt, -24),
        reminder24hSentAt: addHours(manageableStartAt, -23),
      },
      select: { id: true, updatedAt: true },
    }),
    prisma.booking.create({
      data: {
        clientId: primaryClient.id,
        slotId: slots[8].id,
        serviceId: service.id,
        source: "WEB",
        status: BookingStatus.CONFIRMED,
        clientNameSnapshot: `Klientka Manage ${suffix}`,
        clientEmailSnapshot: `client-manage-${suffix}@example.com`,
        clientPhoneSnapshot: "+420777123456",
        serviceNameSnapshot: `Manage service ${suffix}`,
        serviceDurationMinutes: 60,
        scheduledStartsAt: otherBookingStartAt,
        scheduledEndsAt: otherBookingEndAt,
        confirmedAt: addDays(now, -1),
      },
      select: { id: true },
    }),
    prisma.booking.create({
      data: {
        clientId: secondaryClient.id,
        slotId: slots[2].id,
        serviceId: service.id,
        source: "WEB",
        status: BookingStatus.CONFIRMED,
        clientNameSnapshot: `Kolize Manage ${suffix}`,
        clientEmailSnapshot: `client-collision-${suffix}@example.com`,
        clientPhoneSnapshot: "+420777654321",
        serviceNameSnapshot: `Manage service ${suffix}`,
        serviceDurationMinutes: 60,
        scheduledStartsAt: conflictStartAt,
        scheduledEndsAt: conflictEndAt,
        confirmedAt: addDays(now, -1),
      },
      select: { id: true },
    }),
    prisma.booking.create({
      data: {
        clientId: primaryClient.id,
        slotId: slots[3].id,
        serviceId: service.id,
        source: "WEB",
        status: BookingStatus.CONFIRMED,
        clientNameSnapshot: `Klientka Manage ${suffix}`,
        clientEmailSnapshot: `client-manage-${suffix}@example.com`,
        clientPhoneSnapshot: "+420777123456",
        serviceNameSnapshot: `Manage service ${suffix}`,
        serviceDurationMinutes: 60,
        scheduledStartsAt: tooLateStartAt,
        scheduledEndsAt: tooLateEndAt,
        confirmedAt: addDays(now, -1),
      },
      select: { id: true },
    }),
    prisma.booking.create({
      data: {
        clientId: primaryClient.id,
        slotId: slots[5].id,
        serviceId: service.id,
        source: "WEB",
        status: BookingStatus.COMPLETED,
        clientNameSnapshot: `Klientka Manage ${suffix}`,
        clientEmailSnapshot: `client-manage-${suffix}@example.com`,
        clientPhoneSnapshot: "+420777123456",
        serviceNameSnapshot: `Manage service ${suffix}`,
        serviceDurationMinutes: 60,
        scheduledStartsAt: completedStartAt,
        scheduledEndsAt: completedEndAt,
        confirmedAt: addDays(now, -2),
        completedAt: addDays(now, -1),
      },
      select: { id: true },
    }),
    prisma.booking.create({
      data: {
        clientId: primaryClient.id,
        slotId: slots[6].id,
        serviceId: service.id,
        source: "WEB",
        status: BookingStatus.CANCELLED,
        clientNameSnapshot: `Klientka Manage ${suffix}`,
        clientEmailSnapshot: `client-manage-${suffix}@example.com`,
        clientPhoneSnapshot: "+420777123456",
        serviceNameSnapshot: `Manage service ${suffix}`,
        serviceDurationMinutes: 60,
        scheduledStartsAt: cancelledStartAt,
        scheduledEndsAt: cancelledEndAt,
        confirmedAt: addDays(now, -2),
        cancelledAt: addDays(now, -1),
      },
      select: { id: true },
    }),
    prisma.booking.create({
      data: {
        clientId: primaryClient.id,
        slotId: slots[7].id,
        serviceId: service.id,
        source: "WEB",
        status: BookingStatus.NO_SHOW,
        clientNameSnapshot: `Klientka Manage ${suffix}`,
        clientEmailSnapshot: `client-manage-${suffix}@example.com`,
        clientPhoneSnapshot: "+420777123456",
        serviceNameSnapshot: `Manage service ${suffix}`,
        serviceDurationMinutes: 60,
        scheduledStartsAt: noShowStartAt,
        scheduledEndsAt: noShowEndAt,
        confirmedAt: addDays(now, -2),
      },
      select: { id: true },
    }),
  ]);

  const tokenFixtures = [
    {
      rawToken: `manage-${suffix}`,
      bookingId: manageableBooking.id,
      type: BookingActionTokenType.RESCHEDULE,
    },
    {
      rawToken: `manage-other-${suffix}`,
      bookingId: otherBooking.id,
      type: BookingActionTokenType.RESCHEDULE,
    },
    {
      rawToken: `manage-completed-${suffix}`,
      bookingId: completedBooking.id,
      type: BookingActionTokenType.RESCHEDULE,
    },
    {
      rawToken: `manage-cancelled-${suffix}`,
      bookingId: cancelledBooking.id,
      type: BookingActionTokenType.RESCHEDULE,
    },
    {
      rawToken: `manage-too-late-${suffix}`,
      bookingId: tooLateBooking.id,
      type: BookingActionTokenType.RESCHEDULE,
    },
    {
      rawToken: `cancel-${suffix}`,
      bookingId: manageableBooking.id,
      type: BookingActionTokenType.CANCEL,
    },
    {
      rawToken: `cancel-secondary-${suffix}`,
      bookingId: manageableBooking.id,
      type: BookingActionTokenType.CANCEL,
    },
    {
      rawToken: `cancel-deadline-${suffix}`,
      bookingId: tooLateBooking.id,
      type: BookingActionTokenType.CANCEL,
    },
    {
      rawToken: `cancel-no-show-${suffix}`,
      bookingId: noShowBooking.id,
      type: BookingActionTokenType.CANCEL,
    },
  ];

  await prisma.bookingActionToken.createMany({
    data: tokenFixtures.map((fixture) => ({
      bookingId: fixture.bookingId,
      type: fixture.type,
      tokenHash: hashBookingActionToken(fixture.rawToken),
      expiresAt: addDays(now, 30),
      lastSentAt: now,
    })),
  });

  return {
    actorUserId: actor.id,
    categoryId: category.id,
    serviceId: service.id,
    primaryClientId: primaryClient.id,
    secondaryClientId: secondaryClient.id,
    manageableBookingId: manageableBooking.id,
    manageableBookingUpdatedAt: manageableBooking.updatedAt.toISOString(),
    manageableStartAt: manageableStartAt.toISOString(),
    manageableCurrentSlotId: slots[0].id,
    replacementSlotId: slots[1].id,
    replacementStartAt: replacementStartAt.toISOString(),
    otherBookingId: otherBooking.id,
    otherManageTokenRaw: `manage-other-${suffix}`,
    manageTokenRaw: `manage-${suffix}`,
    completedManageTokenRaw: `manage-completed-${suffix}`,
    cancelledManageTokenRaw: `manage-cancelled-${suffix}`,
    cancelTokenRaw: `cancel-${suffix}`,
    secondaryCancelTokenRaw: `cancel-secondary-${suffix}`,
    deadlineCancelTokenRaw: `cancel-deadline-${suffix}`,
    noShowCancelTokenRaw: `cancel-no-show-${suffix}`,
    tooLateManageTokenRaw: `manage-too-late-${suffix}`,
    conflictSlotId: slots[2].id,
    conflictStartAt: conflictStartAt.toISOString(),
    tooLateSlotId: slots[3].id,
    tooLateBookingId: tooLateBooking.id,
    tooLateStartAt: tooLateStartAt.toISOString(),
    outsideWindowSlotId: slots[4].id,
    outsideWindowStartAt: outsideWindowStartAt.toISOString(),
    completedBookingId: completedBooking.id,
    cancelledBookingId: cancelledBooking.id,
    noShowBookingId: noShowBooking.id,
    createdBookingIds: [
      manageableBooking.id,
      otherBooking.id,
      conflictingBooking.id,
      tooLateBooking.id,
      completedBooking.id,
      cancelledBooking.id,
      noShowBooking.id,
    ],
    createdSlotIds: slots.map((slot) => slot.id),
    createdTokenHashes: tokenFixtures.map((fixture) => hashBookingActionToken(fixture.rawToken)),
  } satisfies SeedContext;
}

async function cleanupSeed(seed: SeedContext) {
  const { prisma } = await loadModules();

  await prisma.emailLog.deleteMany({
    where: {
      bookingId: {
        in: seed.createdBookingIds,
      },
    },
  });
  await prisma.bookingStatusHistory.deleteMany({
    where: {
      bookingId: {
        in: seed.createdBookingIds,
      },
    },
  });
  await prisma.bookingRescheduleLog.deleteMany({
    where: {
      bookingId: {
        in: seed.createdBookingIds,
      },
    },
  });
  await prisma.bookingActionToken.deleteMany({
    where: {
      OR: [
        {
          bookingId: {
            in: seed.createdBookingIds,
          },
        },
        {
          tokenHash: {
            in: seed.createdTokenHashes,
          },
        },
      ],
    },
  });
  await prisma.booking.deleteMany({
    where: {
      id: {
        in: seed.createdBookingIds,
      },
    },
  });
  await prisma.availabilitySlot.deleteMany({
    where: {
      id: {
        in: seed.createdSlotIds,
      },
    },
  });
  await prisma.client.deleteMany({
    where: {
      id: {
        in: [seed.primaryClientId, seed.secondaryClientId],
      },
    },
  });
  await prisma.service.deleteMany({ where: { id: seed.serviceId } });
  await prisma.serviceCategory.deleteMany({ where: { id: seed.categoryId } });
  await prisma.adminUser.deleteMany({ where: { id: seed.actorUserId } });
}

async function findManageTokenSnapshot(
  prisma: Awaited<ReturnType<typeof loadModules>>["prisma"],
  tokenHash: string,
) {
  return prisma.bookingActionToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      bookingId: true,
      type: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      booking: {
        select: {
          id: true,
          status: true,
          updatedAt: true,
          serviceId: true,
          serviceDurationMinutes: true,
          cleanupBlockMinutes: true,
          serviceNameSnapshot: true,
          clientNameSnapshot: true,
          scheduledStartsAt: true,
          scheduledEndsAt: true,
        },
      },
    },
  });
}

describe("public booking access", () => {
  dbTest("returns booking detail for valid management token", async () => {
    const seed = await createSeed();
    const {
      prisma,
      getPublicBookingManagementPageState,
      BookingActionTokenType,
    } = await loadModules();

    try {
      const result = await getPublicBookingManagementPageState(seed.manageTokenRaw);

      assert.equal(result.status, "ready");
      if (result.status !== "ready") {
        throw new Error("Expected ready booking-management state.");
      }

      assert.equal(result.bookingId, seed.manageableBookingId);
      assert.equal(result.serviceId, seed.serviceId);
      assert.equal(result.serviceDurationMinutes, 60);
      assert.match(result.statusLabel, /Potvrzená/i);
      assert.equal(result.scheduledStartsAt, seed.manageableStartAt);
      assert.ok(result.slots.some((slot) => slot.id === seed.replacementSlotId));

      const issuedCancellationTokenCount = await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: BookingActionTokenType.CANCEL,
          tokenHash: {
            notIn: seed.createdTokenHashes,
          },
        },
      });

      assert.equal(issuedCancellationTokenCount, 0);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("rejects booking detail for invalid token", async () => {
    const seed = await createSeed();
    const { getPublicBookingManagementPageState } = await loadModules();

    try {
      const result = await getPublicBookingManagementPageState(`missing-${randomUUID()}`);

      assert.equal(result.status, "invalid");
      assert.match(result.message, /neplatný nebo už neexistuje/i);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("does not allow managing booking with token of another booking", async () => {
    const seed = await createSeed();
    const { getPublicBookingManagementPageState } = await loadModules();

    try {
      const ownBooking = await getPublicBookingManagementPageState(seed.manageTokenRaw);
      const otherBooking = await getPublicBookingManagementPageState(seed.otherManageTokenRaw);

      assert.equal(ownBooking.status, "ready");
      assert.equal(otherBooking.status, "ready");

      if (ownBooking.status !== "ready" || otherBooking.status !== "ready") {
        throw new Error("Expected both management tokens to resolve to ready state.");
      }

      assert.equal(ownBooking.bookingId, seed.manageableBookingId);
      assert.equal(otherBooking.bookingId, seed.otherBookingId);
      assert.notEqual(ownBooking.bookingId, otherBooking.bookingId);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("returns blocked state for bookings that public management no longer supports", async () => {
    const seed = await createSeed();
    const { getPublicBookingManagementPageState } = await loadModules();

    try {
      const cancelled = await getPublicBookingManagementPageState(seed.cancelledManageTokenRaw);
      const completed = await getPublicBookingManagementPageState(seed.completedManageTokenRaw);
      const deadlineBlocked = await getPublicBookingManagementPageState(seed.tooLateManageTokenRaw);

      assert.equal(cancelled.status, "already_cancelled");
      assert.equal(completed.status, "not_reschedulable");
      assert.equal(deadlineBlocked.status, "not_reschedulable");
      assert.match(deadlineBlocked.message, /méně než 24 hodin/i);
    } finally {
      await cleanupSeed(seed);
    }
  });
});

describe("cancel booking flow", () => {
  dbTest("souběžné storno stejného tokenu vrátí výsledek oběma požadavkům", async () => {
    const seed = await createSeed();
    const { prisma, cancelPublicBookingByToken, hashBookingActionToken } = await loadModules();
    let unlock!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const lockReady = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BookingActionToken" WHERE "tokenHash" = ${hashBookingActionToken(seed.cancelTokenRaw)} FOR UPDATE`;
      locked();
      await gate;
    }, { timeout: 15_000 });
    let cancellations: Promise<PromiseSettledResult<Awaited<ReturnType<typeof cancelPublicBookingByToken>>>[]> | undefined;

    try {
      await Promise.race([lockReady, blocker]);
      cancellations = Promise.allSettled([
        cancelPublicBookingByToken(seed.cancelTokenRaw),
        cancelPublicBookingByToken(seed.cancelTokenRaw),
      ]);
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && waiting < 2; attempt += 1) {
        const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS "count" FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%BookingActionToken%' AND query LIKE '%FOR UPDATE%'
        `;
        waiting = row.count;
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(waiting, 2, "Oba požadavky musí čekat na stejný token.");
      unlock();
      await blocker;
      const results = await cancellations;
      const statuses = results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value.status;
      });
      assert.deepEqual(statuses.sort(), ["already_cancelled", "cancelled"]);
    } finally {
      unlock();
      await blocker.catch(() => {});
      await cancellations;
      await cleanupSeed(seed);
    }
  });

  dbTest("explicit cancellation link expires after the booking start grace period", async () => {
    const seed = await createSeed();
    const {
      prisma,
      issuePublicCancellationUrlByManageToken,
      buildBookingSelfServiceActionExpiry,
      hashBookingActionToken,
      BookingActionTokenType,
    } = await loadModules();

    try {
      const result = await issuePublicCancellationUrlByManageToken(seed.manageTokenRaw);

      assert.equal(result.status, "issued");
      if (result.status !== "issued") {
        throw new Error("Expected cancellation URL issuance to succeed.");
      }

      const rawToken = result.cancellationUrl.split("/").pop();
      assert.ok(rawToken);
      const [booking, token] = await Promise.all([
        prisma.booking.findUniqueOrThrow({
          where: { id: seed.manageableBookingId },
          select: { scheduledStartsAt: true },
        }),
        prisma.bookingActionToken.findUniqueOrThrow({
          where: { tokenHash: hashBookingActionToken(rawToken) },
          select: { type: true, expiresAt: true },
        }),
      ]);

      assert.equal(token.type, BookingActionTokenType.CANCEL);
      assert.equal(
        token.expiresAt.toISOString(),
        buildBookingSelfServiceActionExpiry(booking.scheduledStartsAt).toISOString(),
      );
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("does not issue a cancellation token when the manage token is revoked before the transaction", async () => {
    const seed = await createSeed();
    const {
      prisma,
      issuePublicCancellationUrlByManageToken,
      hashBookingActionToken,
      BookingActionTokenType,
    } = await loadModules();

    try {
      const beforeCount = await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: BookingActionTokenType.CANCEL,
        },
      });

      await prisma.bookingActionToken.update({
        where: { tokenHash: hashBookingActionToken(seed.manageTokenRaw) },
        data: { revokedAt: new Date() },
      });

      const result = await issuePublicCancellationUrlByManageToken(seed.manageTokenRaw);

      assert.equal(result.status, "invalid");
      const afterCount = await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: BookingActionTokenType.CANCEL,
        },
      });
      assert.equal(afterCount, beforeCount);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("does not issue a cancellation token when revocation wins after the initial lookup", async () => {
    const seed = await createSeed();
    const {
      prisma,
      createBookingManagementApi,
      BookingActionTokenType,
    } = await loadModules();

    try {
      const api = createBookingManagementApi({
        findManageToken: async (tokenHash) => {
          const snapshot = await findManageTokenSnapshot(prisma, tokenHash);
          await prisma.bookingActionToken.update({
            where: { tokenHash },
            data: { revokedAt: new Date() },
          });
          return snapshot;
        },
      });
      const beforeCount = await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: BookingActionTokenType.CANCEL,
        },
      });

      const result = await api.issuePublicCancellationUrlByManageToken(seed.manageTokenRaw);

      assert.equal(result.status, "invalid");
      assert.equal(
        await prisma.bookingActionToken.count({
          where: {
            bookingId: seed.manageableBookingId,
            type: BookingActionTokenType.CANCEL,
          },
        }),
        beforeCount,
      );
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("cancels confirmed booking when token is valid", async () => {
    const seed = await createSeed();
    const {
      prisma,
      cancelPublicBookingByToken,
      hashBookingActionToken,
      BookingActorType,
      BookingSource,
      BookingStatus,
      EmailLogType,
    } = await loadModules();

    try {
      const result = await cancelPublicBookingByToken(seed.cancelTokenRaw);

      assert.equal(result.status, "cancelled");
      if (result.status !== "cancelled") {
        throw new Error("Expected booking cancellation to succeed.");
      }

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: seed.manageableBookingId },
        select: {
          status: true,
          cancelledAt: true,
        },
      });

      assert.equal(booking.status, BookingStatus.CANCELLED);
      assert.ok(booking.cancelledAt);

      const statusHistory = await prisma.bookingStatusHistory.findFirstOrThrow({
        where: {
          bookingId: seed.manageableBookingId,
          reason: "public-cancellation-flow-v1",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      assert.equal(statusHistory.actorType, BookingActorType.CLIENT);
      assert.equal(statusHistory.status, BookingStatus.CANCELLED);
      assert.deepEqual(statusHistory.metadata, {
        source: BookingSource.WEB,
        via: "cancellation-token",
      });

      const primaryToken = await prisma.bookingActionToken.findUniqueOrThrow({
        where: {
          tokenHash: hashBookingActionToken(seed.cancelTokenRaw),
        },
        select: {
          usedAt: true,
          revokedAt: true,
        },
      });
      const siblingToken = await prisma.bookingActionToken.findUniqueOrThrow({
        where: {
          tokenHash: hashBookingActionToken(seed.secondaryCancelTokenRaw),
        },
        select: {
          usedAt: true,
          revokedAt: true,
        },
      });

      assert.ok(primaryToken.usedAt);
      assert.equal(primaryToken.revokedAt, null);
      assert.equal(siblingToken.usedAt, null);
      assert.ok(siblingToken.revokedAt);

      const emailLogs = await prisma.emailLog.findMany({
        where: {
          bookingId: seed.manageableBookingId,
          type: EmailLogType.BOOKING_CANCELLED,
        },
        orderBy: {
          recipientEmail: "asc",
        },
        select: {
          recipientEmail: true,
          templateKey: true,
        },
      });

      assert.deepEqual(
        emailLogs.map((emailLog) => emailLog.templateKey).sort(),
        ["admin-booking-cancelled-v1", "booking-cancelled-v1"],
      );
      assert.equal(emailLogs.length, 2);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("public cancellation odmítne aktivní delivery lease a po expiraci zvýší generaci", async () => {
    const seed = await createSeed();
    const { prisma, cancelPublicBookingByToken, BookingStatus } = await loadModules();

    try {
      await prisma.booking.update({
        where: { id: seed.manageableBookingId },
        data: {
          clientDeliveryLeaseToken: "public-cancellation-worker",
          clientDeliveryLeaseExpiresAt: new Date(Date.now() + 60 * 1000),
        },
      });

      const blocked = await cancelPublicBookingByToken(seed.cancelTokenRaw);
      assert.equal(blocked.status, "concurrent_modification");
      assert.deepEqual(
        await prisma.booking.findUniqueOrThrow({
          where: { id: seed.manageableBookingId },
          select: { status: true, communicationGeneration: true },
        }),
        { status: BookingStatus.CONFIRMED, communicationGeneration: 1 },
      );

      await prisma.booking.update({
        where: { id: seed.manageableBookingId },
        data: { clientDeliveryLeaseExpiresAt: new Date(0) },
      });

      const cancelled = await cancelPublicBookingByToken(seed.cancelTokenRaw);
      assert.equal(cancelled.status, "cancelled");
      assert.deepEqual(
        await prisma.booking.findUniqueOrThrow({
          where: { id: seed.manageableBookingId },
          select: { status: true, communicationGeneration: true },
        }),
        { status: BookingStatus.CANCELLED, communicationGeneration: 2 },
      );
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("cancellation restores an archived slot with a service restriction", async () => {
    const seed = await createSeed();
    const { prisma, cancelPublicBookingByToken, AvailabilitySlotStatus } = await loadModules();

    try {
      await prisma.availabilitySlot.update({
        where: { id: seed.manageableCurrentSlotId },
        data: {
          status: AvailabilitySlotStatus.ARCHIVED,
          serviceRestrictionMode: "SELECTED",
          allowedServices: {
            create: {
              serviceId: seed.serviceId,
            },
          },
        },
      });

      const result = await cancelPublicBookingByToken(seed.cancelTokenRaw);

      assert.equal(result.status, "cancelled");

      const slot = await prisma.availabilitySlot.findUniqueOrThrow({
        where: { id: seed.manageableCurrentSlotId },
        select: {
          status: true,
          capacity: true,
          serviceRestrictionMode: true,
          allowedServices: {
            select: { serviceId: true },
          },
        },
      });

      assert.equal(slot.status, AvailabilitySlotStatus.PUBLISHED);
      assert.equal(slot.capacity, 1);
      assert.equal(slot.serviceRestrictionMode, "SELECTED");
      assert.deepEqual(slot.allowedServices, [{ serviceId: seed.serviceId }]);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("public cancellation po manual override obnoví celý archivovaný původní interval", async () => {
    const seed = await createSeed();
    const { prisma, cancelPublicBookingByToken, AvailabilitySlotStatus, BookingStatus } = await loadModules();
    let adminDraftSlotId: string | null = null;
    let archivedOriginalSlotId: string | null = null;

    try {
      const manualOverrideSlot = await prisma.availabilitySlot.findUniqueOrThrow({
        where: { id: seed.manageableCurrentSlotId },
        select: { startsAt: true, endsAt: true },
      });

      const originalStartsAt = addHours(manualOverrideSlot.startsAt, -1);
      const originalEndsAt = addHours(manualOverrideSlot.endsAt, 1);
      const archivedOriginalSlot = await prisma.availabilitySlot.create({
        data: {
          startsAt: originalStartsAt,
          endsAt: originalEndsAt,
          capacity: 1,
          status: AvailabilitySlotStatus.ARCHIVED,
          serviceRestrictionMode: "ANY",
          createdByUserId: seed.actorUserId,
        },
        select: { id: true },
      });
      archivedOriginalSlotId = archivedOriginalSlot.id;

      await prisma.$transaction([
        prisma.booking.update({
          where: { id: seed.manageableBookingId },
          data: { manualOverride: true },
        }),
        prisma.availabilitySlot.update({
          where: { id: seed.manageableCurrentSlotId },
          data: { status: AvailabilitySlotStatus.DRAFT },
        }),
      ]);

      const adminDraftSlot = await prisma.availabilitySlot.create({
        data: {
          startsAt: addHours(manualOverrideSlot.endsAt, 2),
          endsAt: addHours(manualOverrideSlot.endsAt, 3),
          capacity: 1,
          status: AvailabilitySlotStatus.DRAFT,
          serviceRestrictionMode: "ANY",
          createdByUserId: seed.actorUserId,
          internalNote: "Skutečná administrativní blokace",
        },
        select: { id: true },
      });
      adminDraftSlotId = adminDraftSlot.id;

      const result = await cancelPublicBookingByToken(seed.cancelTokenRaw);

      assert.equal(result.status, "cancelled");
      const [booking, manualOverrideSlotAfterCancellation, archivedOriginalSlotAfterCancellation, adminDraftSlotAfterCancellation] = await Promise.all([
        prisma.booking.findUniqueOrThrow({
          where: { id: seed.manageableBookingId },
          select: { status: true },
        }),
        prisma.availabilitySlot.findUniqueOrThrow({
          where: { id: seed.manageableCurrentSlotId },
          select: { status: true },
        }),
        prisma.availabilitySlot.findUniqueOrThrow({
          where: { id: archivedOriginalSlot.id },
          select: { status: true, startsAt: true, endsAt: true },
        }),
        prisma.availabilitySlot.findUniqueOrThrow({
          where: { id: adminDraftSlot.id },
          select: { status: true },
        }),
      ]);

      assert.equal(booking.status, BookingStatus.CANCELLED);
      assert.equal(manualOverrideSlotAfterCancellation.status, AvailabilitySlotStatus.ARCHIVED);
      assert.equal(archivedOriginalSlotAfterCancellation.status, AvailabilitySlotStatus.PUBLISHED);
      assert.equal(archivedOriginalSlotAfterCancellation.startsAt.toISOString(), originalStartsAt.toISOString());
      assert.equal(archivedOriginalSlotAfterCancellation.endsAt.toISOString(), originalEndsAt.toISOString());
      assert.equal(adminDraftSlotAfterCancellation.status, AvailabilitySlotStatus.DRAFT);
    } finally {
      if (adminDraftSlotId) {
        await prisma.availabilitySlot.deleteMany({ where: { id: adminDraftSlotId } });
      }
      if (archivedOriginalSlotId) {
        await prisma.availabilitySlot.deleteMany({ where: { id: archivedOriginalSlotId } });
      }
      await cleanupSeed(seed);
    }
  });

  dbTest("cancellation does not compact a SELECTED slot with an adjacent ANY slot", async () => {
    const seed = await createSeed();
    const { prisma, cancelPublicBookingByToken, AvailabilitySlotStatus } = await loadModules();
    let adjacentSlotId: string | null = null;

    try {
      const slot = await prisma.availabilitySlot.findUniqueOrThrow({
        where: { id: seed.manageableCurrentSlotId },
        select: { startsAt: true, endsAt: true },
      });

      await prisma.availabilitySlot.update({
        where: { id: seed.manageableCurrentSlotId },
        data: {
          serviceRestrictionMode: "SELECTED",
          allowedServices: { create: { serviceId: seed.serviceId } },
        },
      });
      const adjacentSlot = await prisma.availabilitySlot.create({
        data: {
          startsAt: slot.endsAt,
          endsAt: addHours(slot.endsAt, 0.5),
          capacity: 1,
          status: AvailabilitySlotStatus.PUBLISHED,
          serviceRestrictionMode: "ANY",
          publishedAt: new Date(),
          createdByUserId: seed.actorUserId,
        },
        select: { id: true },
      });
      adjacentSlotId = adjacentSlot.id;

      const result = await cancelPublicBookingByToken(seed.cancelTokenRaw);

      assert.equal(result.status, "cancelled");
      const slots = await prisma.availabilitySlot.findMany({
        where: { id: { in: [seed.manageableCurrentSlotId, adjacentSlot.id] } },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, endsAt: true, serviceRestrictionMode: true },
      });

      assert.deepEqual(slots, [
        {
          id: seed.manageableCurrentSlotId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          serviceRestrictionMode: "SELECTED",
        },
        {
          id: adjacentSlot.id,
          startsAt: slot.endsAt,
          endsAt: addHours(slot.endsAt, 0.5),
          serviceRestrictionMode: "ANY",
        },
      ]);
    } finally {
      if (adjacentSlotId) {
        await prisma.availabilitySlot.deleteMany({ where: { id: adjacentSlotId } });
      }
      await cleanupSeed(seed);
    }
  });

  test("capacity-2 slot is not compacted with an adjacent capacity-1 slot", async () => {
    const findFirstCalls: Array<{ where: Record<string, unknown> }> = [];
    const capacityTwoSlot = {
      id: "capacity-two",
      startsAt: new Date("2030-01-01T10:00:00Z"),
      endsAt: new Date("2030-01-01T11:00:00Z"),
      status: "PUBLISHED" as const,
      capacity: 2,
      publicNote: null,
      internalNote: null,
      serviceRestrictionMode: "ANY" as const,
      createdByUserId: null,
      allowedServices: [],
      bookings: [],
    };
    const tx = {
      availabilitySlot: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          findFirstCalls.push(args);
          return findFirstCalls.length === 1 ? capacityTwoSlot : null;
        },
      },
    } as never;

    const result = await compactAdjacentEditableSlotsForBooking(tx, capacityTwoSlot.id);

    assert.deepEqual(result, capacityTwoSlot);
    assert.equal(findFirstCalls[1].where.capacity, 1);
  });

  dbTest("cancellation restores the unblocked part of an archived slot", async () => {
    const seed = await createSeed();
    const { prisma, cancelPublicBookingByToken, AvailabilitySlotStatus } = await loadModules();
    let overlappingSlotId: string | null = null;

    try {
      const originalSlot = await prisma.availabilitySlot.findUniqueOrThrow({
        where: { id: seed.manageableCurrentSlotId },
        select: { startsAt: true, endsAt: true },
      });
      const overlapStartsAt = addHours(originalSlot.endsAt, -0.25);

      await prisma.availabilitySlot.update({
        where: { id: seed.manageableCurrentSlotId },
        data: { status: AvailabilitySlotStatus.ARCHIVED },
      });
      const overlappingSlot = await prisma.availabilitySlot.create({
        data: {
          startsAt: overlapStartsAt,
          endsAt: originalSlot.endsAt,
          capacity: 1,
          status: AvailabilitySlotStatus.PUBLISHED,
          serviceRestrictionMode: "ANY",
          publishedAt: new Date(),
          createdByUserId: seed.actorUserId,
        },
        select: { id: true },
      });
      overlappingSlotId = overlappingSlot.id;

      const result = await cancelPublicBookingByToken(seed.cancelTokenRaw);

      assert.equal(result.status, "cancelled");

      const restoredSlot = await prisma.availabilitySlot.findUniqueOrThrow({
        where: { id: seed.manageableCurrentSlotId },
        select: { status: true, startsAt: true, endsAt: true },
      });

      assert.equal(restoredSlot.status, AvailabilitySlotStatus.PUBLISHED);
      assert.equal(restoredSlot.startsAt.toISOString(), originalSlot.startsAt.toISOString());
      assert.equal(restoredSlot.endsAt.toISOString(), originalSlot.endsAt.toISOString());
    } finally {
      if (overlappingSlotId) {
        await prisma.availabilitySlot.deleteMany({ where: { id: overlappingSlotId } });
      }
      await cleanupSeed(seed);
    }
  });

  dbTest("cancellation restores an archived historical slot without publishing its cleanup gap", async () => {
    const {
      prisma,
      cancelPublicBookingByToken,
      BookingActionTokenType,
      BookingStatus,
      AvailabilitySlotStatus,
    } = await loadModules();
    const { buildBookingActionExpiry, buildBookingActionToken } = await import("./booking-action-tokens");

    const suffix = randomUUID().slice(0, 8);
    const baseStartAt = await findFreeStartAt(prisma, {
      earliest: addDays(new Date(), 8),
      latest: addDays(new Date(), 30),
      durationMinutes: 120,
      preferredHour: 10,
      preferredMinute: 0,
    });
    const beforeEndsAt = addHours(baseStartAt, 0.5);
    const bookingEndsAt = addHours(baseStartAt, 1.75);
    const cleanupEndsAt = addHours(baseStartAt, 2);
    const fullEndsAt = addHours(baseStartAt, 2.5);

    const actor = await prisma.adminUser.create({
      data: {
        email: `booking-cancel-compact-${suffix}@example.com`,
        name: `Booking Cancel Compact ${suffix}`,
        role: "OWNER",
        isActive: true,
      },
      select: { id: true },
    });

    const category = await prisma.serviceCategory.create({
      data: {
        name: `Compact category ${suffix}`,
        slug: `compact-category-${suffix}`,
        isActive: true,
      },
      select: { id: true },
    });

    const service = await prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Compact service ${suffix}`,
        slug: `compact-service-${suffix}`,
        durationMinutes: 75,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    });

    const client = await prisma.client.create({
      data: {
        fullName: `Compact Client ${suffix}`,
        email: `compact-client-${suffix}@example.com`,
        phone: "+420777123456",
        isActive: true,
      },
      select: { id: true },
    });

    const [, bookedSlot] = await prisma.$transaction([
      prisma.availabilitySlot.create({
        data: {
          startsAt: baseStartAt,
          endsAt: beforeEndsAt,
          capacity: 1,
          status: AvailabilitySlotStatus.PUBLISHED,
          serviceRestrictionMode: "ANY",
          publishedAt: addDays(new Date(), -1),
          createdByUserId: actor.id,
        },
        select: { id: true },
      }),
      prisma.availabilitySlot.create({
        data: {
          startsAt: beforeEndsAt,
          endsAt: bookingEndsAt,
          capacity: 1,
          status: AvailabilitySlotStatus.ARCHIVED,
          serviceRestrictionMode: "ANY",
          publishedAt: addDays(new Date(), -1),
          createdByUserId: actor.id,
        },
        select: { id: true },
      }),
      prisma.availabilitySlot.create({
        data: {
          startsAt: cleanupEndsAt,
          endsAt: fullEndsAt,
          capacity: 1,
          status: AvailabilitySlotStatus.PUBLISHED,
          serviceRestrictionMode: "ANY",
          publishedAt: addDays(new Date(), -1),
          createdByUserId: actor.id,
        },
        select: { id: true },
      }),
    ]);

    const booking = await prisma.booking.create({
      data: {
        clientId: client.id,
        slotId: bookedSlot.id,
        serviceId: service.id,
        status: BookingStatus.CONFIRMED,
        source: "WEB",
        clientNameSnapshot: `Compact Client ${suffix}`,
        clientEmailSnapshot: `compact-client-${suffix}@example.com`,
        clientPhoneSnapshot: "+420777123456",
        serviceNameSnapshot: `Compact service ${suffix}`,
        serviceDurationMinutes: 75,
        cleanupMinutes: 10,
        cleanupBlockMinutes: 15,
        servicePriceFromCzk: 1400,
        scheduledStartsAt: beforeEndsAt,
        scheduledEndsAt: bookingEndsAt,
        blockedUntil: cleanupEndsAt,
        originalAvailabilityEndsAt: bookingEndsAt,
      },
      select: { id: true },
    });

    const cancellationToken = buildBookingActionToken();

    await prisma.bookingActionToken.create({
      data: {
        bookingId: booking.id,
        type: BookingActionTokenType.CANCEL,
        tokenHash: cancellationToken.tokenHash,
        expiresAt: buildBookingActionExpiry(new Date()),
      },
    });

    try {
      const result = await cancelPublicBookingByToken(cancellationToken.rawToken);

      assert.equal(result.status, "cancelled");

      const updatedBooking = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: {
          status: true,
          slotId: true,
        },
      });

      assert.equal(updatedBooking.status, BookingStatus.CANCELLED);
      assert.equal(updatedBooking.slotId, bookedSlot.id);

      const slots = await prisma.availabilitySlot.findMany({
        where: {
          createdByUserId: actor.id,
        },
        orderBy: {
          startsAt: "asc",
        },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
        },
      });

      assert.deepEqual(
        slots.map((slot) => ({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          status: slot.status,
        })),
        [
          {
            startsAt: baseStartAt.toISOString(),
            endsAt: bookingEndsAt.toISOString(),
            status: AvailabilitySlotStatus.PUBLISHED,
          },
          {
            startsAt: cleanupEndsAt.toISOString(),
            endsAt: fullEndsAt.toISOString(),
            status: AvailabilitySlotStatus.PUBLISHED,
          },
        ],
      );
    } finally {
      await prisma.emailLog.deleteMany({
        where: { bookingId: booking.id },
      });
      await prisma.bookingStatusHistory.deleteMany({
        where: { bookingId: booking.id },
      });
      await prisma.bookingActionToken.deleteMany({
        where: { bookingId: booking.id },
      });
      await prisma.booking.deleteMany({
        where: { id: booking.id },
      });
      await prisma.availabilitySlot.deleteMany({
        where: { createdByUserId: actor.id },
      });
      await prisma.client.deleteMany({
        where: { id: client.id },
      });
      await prisma.service.deleteMany({
        where: { id: service.id },
      });
      await prisma.serviceCategory.deleteMany({
        where: { id: category.id },
      });
      await prisma.adminUser.deleteMany({
        where: { id: actor.id },
      });
    }
  });

  dbTest("rejects cancellation after deadline and leaves booking unchanged", async () => {
    const seed = await createSeed();
    const { prisma, cancelPublicBookingByToken, BookingStatus, EmailLogType } = await loadModules();

    try {
      const result = await cancelPublicBookingByToken(seed.deadlineCancelTokenRaw);

      assert.equal(result.status, "not_cancellable");
      assert.match(result.message, /méně než 24 hodin/i);

      const deadlineBooking = await prisma.booking.findUniqueOrThrow({
        where: { id: seed.tooLateBookingId },
        select: {
          status: true,
          cancelledAt: true,
        },
      });

      assert.equal(deadlineBooking.status, BookingStatus.CONFIRMED);
      assert.equal(deadlineBooking.cancelledAt, null);

      const historyCount = await prisma.bookingStatusHistory.count({
        where: {
          bookingId: seed.tooLateBookingId,
          reason: "public-cancellation-flow-v1",
        },
      });
      const emailCount = await prisma.emailLog.count({
        where: {
          bookingId: seed.tooLateBookingId,
          type: EmailLogType.BOOKING_CANCELLED,
        },
      });

      assert.equal(historyCount, 0);
      assert.equal(emailCount, 0);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("rejects cancellation for terminal booking states", async () => {
    const seed = await createSeed();
    const { prisma, cancelPublicBookingByToken, BookingStatus } = await loadModules();

    try {
      const result = await cancelPublicBookingByToken(seed.noShowCancelTokenRaw);

      assert.equal(result.status, "not_cancellable");
      assert.match(result.message, /už nejde přes storno odkaz upravit/i);

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: seed.noShowBookingId },
        select: {
          status: true,
        },
      });

      assert.equal(booking.status, BookingStatus.NO_SHOW);
    } finally {
      await cleanupSeed(seed);
    }
  });
});

describe("reschedule booking flow", () => {
  dbTest("reschedules confirmed booking to a valid free slot", async () => {
    const seed = await createSeed();
    const {
      prisma,
      reschedulePublicBookingByToken,
      buildBookingSelfServiceActionExpiry,
      BookingActionTokenType,
      EmailAudience,
      EmailLogType,
    } = await loadModules();

    try {
      const rescheduleMasterContact = {
        fullName: `CRM klientka po přesunu ${randomUUID().slice(0, 8)}`,
        email: `reschedule-master-${randomUUID().slice(0, 8)}@example.com`,
        phone: `+4207${String(Number.parseInt(randomUUID().replace(/\D/g, "").slice(0, 8) || "1", 10) % 100_000_000).padStart(8, "0")}`,
      };
      await prisma.client.update({
        where: { id: seed.primaryClientId },
        data: rescheduleMasterContact,
      });

      const result = await reschedulePublicBookingByToken({
        token: seed.manageTokenRaw,
        slotId: seed.replacementSlotId,
        newStartAt: seed.replacementStartAt,
        expectedUpdatedAt: seed.manageableBookingUpdatedAt,
      });

      assert.equal(result.status, "rescheduled");
      if (result.status !== "rescheduled") {
        throw new Error("Expected public reschedule to succeed.");
      }

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: seed.manageableBookingId },
        select: {
          slotId: true,
          scheduledStartsAt: true,
          scheduledEndsAt: true,
          rescheduleCount: true,
          reminder24hQueuedAt: true,
          reminder24hSentAt: true,
        },
      });

      assert.equal(booking.slotId, seed.replacementSlotId);
      assert.equal(booking.scheduledStartsAt.toISOString(), seed.replacementStartAt);
      assert.equal(booking.scheduledEndsAt.toISOString(), addHours(new Date(seed.replacementStartAt), 1).toISOString());
      assert.equal(booking.rescheduleCount, 1);
      assert.equal(booking.reminder24hQueuedAt, null);
      assert.equal(booking.reminder24hSentAt, null);

      const clientAfterPublicReschedule = await prisma.client.findUniqueOrThrow({
        where: { id: seed.primaryClientId },
        select: { fullName: true, email: true, phone: true },
      });
      assert.deepEqual(clientAfterPublicReschedule, rescheduleMasterContact);

      const rescheduleLog = await prisma.bookingRescheduleLog.findFirstOrThrow({
        where: { bookingId: seed.manageableBookingId },
        orderBy: { createdAt: "desc" },
      });

      assert.equal(rescheduleLog.changedByUserId, null);
      assert.equal(rescheduleLog.changedByClient, true);
      assert.equal(rescheduleLog.newStartAt.toISOString(), seed.replacementStartAt);

      const emailLog = await prisma.emailLog.findFirstOrThrow({
        where: {
          bookingId: seed.manageableBookingId,
          type: EmailLogType.BOOKING_RESCHEDULED,
          templateKey: "booking-rescheduled-v1",
        },
        orderBy: { createdAt: "desc" },
        select: {
          audience: true,
          templateKey: true,
          payload: true,
          actionTokenId: true,
        },
      });

      assert.equal(emailLog.templateKey, "booking-rescheduled-v1");
      assert.equal(emailLog.audience, EmailAudience.CLIENT);
      assert.equal(typeof emailLog.payload, "object");
      assert.ok(emailLog.payload && typeof emailLog.payload === "object" && !Array.isArray(emailLog.payload));
      const payload = emailLog.payload as Record<string, unknown>;
      assert.ok("manageReservationUrl" in payload);
      assert.ok("cancellationUrl" in payload);
      assert.ok("includeCalendarAttachment" in payload);
      assert.equal(
        (payload as { includeCalendarAttachment: boolean }).includeCalendarAttachment,
        true,
      );

      const newActionTokens = await prisma.bookingActionToken.findMany({
        where: {
          bookingId: seed.manageableBookingId,
          type: {
            in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL],
          },
        },
        select: {
          type: true,
          expiresAt: true,
        },
      });

      const tokenTypes = newActionTokens.map((token) => token.type);
      assert.ok(tokenTypes.filter((type) => type === BookingActionTokenType.RESCHEDULE).length >= 2);
      assert.ok(tokenTypes.filter((type) => type === BookingActionTokenType.CANCEL).length >= 3);
      const expectedNewExpiry = buildBookingSelfServiceActionExpiry(new Date(seed.replacementStartAt));
      assert.equal(
        newActionTokens.filter((token) => token.expiresAt.getTime() === expectedNewExpiry.getTime()).length,
        5,
      );

      const adminEmailLog = await prisma.emailLog.findFirstOrThrow({
        where: {
          bookingId: seed.manageableBookingId,
          type: EmailLogType.BOOKING_RESCHEDULED,
          audience: EmailAudience.ADMIN,
          templateKey: "admin-booking-rescheduled-v1",
        },
        select: {
          payload: true,
        },
      });
      const adminPayload = adminEmailLog.payload as Record<string, unknown>;
      assert.equal(adminPayload.scheduledStartsAt, seed.replacementStartAt);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("rolls back public reschedule when revocation wins after the initial lookup", async () => {
    const seed = await createSeed();
    const {
      prisma,
      createBookingManagementApi,
      BookingActionTokenType,
      BookingStatus,
      EmailLogType,
    } = await loadModules();

    try {
      const api = createBookingManagementApi({
        findManageToken: async (tokenHash) => {
          const snapshot = await findManageTokenSnapshot(prisma, tokenHash);
          await prisma.bookingActionToken.update({
            where: { tokenHash },
            data: { revokedAt: new Date() },
          });
          return snapshot;
        },
      });
      const beforeTokenCount = await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: {
            in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL],
          },
        },
      });

      await assert.rejects(
        api.reschedulePublicBookingByToken({
          token: seed.manageTokenRaw,
          slotId: seed.replacementSlotId,
          newStartAt: seed.replacementStartAt,
          expectedUpdatedAt: seed.manageableBookingUpdatedAt,
        }),
        /Odkaz pro správu rezervace už není aktivní/i,
      );

      const [booking, afterTokenCount, historyCount, emailCount] = await Promise.all([
        prisma.booking.findUniqueOrThrow({
          where: { id: seed.manageableBookingId },
          select: { status: true, slotId: true, rescheduleCount: true },
        }),
        prisma.bookingActionToken.count({
          where: {
            bookingId: seed.manageableBookingId,
            type: {
              in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL],
            },
          },
        }),
        prisma.bookingRescheduleLog.count({ where: { bookingId: seed.manageableBookingId } }),
        prisma.emailLog.count({
          where: {
            bookingId: seed.manageableBookingId,
            type: EmailLogType.BOOKING_RESCHEDULED,
          },
        }),
      ]);

      assert.equal(booking.status, BookingStatus.CONFIRMED);
      assert.equal(booking.slotId, seed.manageableCurrentSlotId);
      assert.equal(booking.rescheduleCount, 0);
      assert.equal(afterTokenCount, beforeTokenCount);
      assert.equal(historyCount, 0);
      assert.equal(emailCount, 0);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("rejects expired and used manage tokens without mutating the booking or issuing tokens", async () => {
    const seed = await createSeed();
    const {
      prisma,
      issuePublicCancellationUrlByManageToken,
      reschedulePublicBookingByToken,
      hashBookingActionToken,
      BookingActionTokenType,
    } = await loadModules();

    try {
      const beforeTokenCount = await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: {
            in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL],
          },
        },
      });

      for (const invalidation of [
        { usedAt: new Date(), expiresAt: addDays(new Date(), 30) },
        { usedAt: null, expiresAt: addDays(new Date(), -1) },
      ]) {
        await prisma.bookingActionToken.update({
          where: { tokenHash: hashBookingActionToken(seed.manageTokenRaw) },
          data: invalidation,
        });

        const cancellationResult = await issuePublicCancellationUrlByManageToken(seed.manageTokenRaw);
        assert.ok(cancellationResult.status === "invalid" || cancellationResult.status === "expired");

        const rescheduleResult = await reschedulePublicBookingByToken({
          token: seed.manageTokenRaw,
          slotId: seed.replacementSlotId,
          newStartAt: seed.replacementStartAt,
          expectedUpdatedAt: seed.manageableBookingUpdatedAt,
        });
        assert.ok(rescheduleResult.status === "invalid" || rescheduleResult.status === "expired");
      }

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: seed.manageableBookingId },
        select: { slotId: true, rescheduleCount: true },
      });
      assert.equal(booking.slotId, seed.manageableCurrentSlotId);
      assert.equal(booking.rescheduleCount, 0);
      assert.equal(
        await prisma.bookingActionToken.count({
          where: {
            bookingId: seed.manageableBookingId,
            type: {
              in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL],
            },
          },
        }),
        beforeTokenCount,
      );
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("rejects reschedule when new slot collides and keeps state unchanged", async () => {
    const seed = await createSeed();
    const {
      prisma,
      reschedulePublicBookingByToken,
      BookingStatus,
      EmailLogType,
    } = await loadModules();

    try {
      await assert.rejects(
        reschedulePublicBookingByToken({
          token: seed.manageTokenRaw,
          slotId: seed.conflictSlotId,
          newStartAt: seed.conflictStartAt,
          expectedUpdatedAt: seed.manageableBookingUpdatedAt,
        }),
        (error: unknown) =>
          typeof error === "object"
          && error !== null
          && "code" in error
          && (error as { code: string }).code === "CONFLICT",
      );

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: seed.manageableBookingId },
        select: {
          slotId: true,
          status: true,
          scheduledStartsAt: true,
        },
      });

      assert.equal(booking.slotId, seed.manageableCurrentSlotId);
      assert.equal(booking.status, BookingStatus.CONFIRMED);

      const historyCount = await prisma.bookingRescheduleLog.count({
        where: {
          bookingId: seed.manageableBookingId,
        },
      });
      const emailCount = await prisma.emailLog.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: EmailLogType.BOOKING_RESCHEDULED,
        },
      });

      assert.equal(historyCount, 0);
      assert.equal(emailCount, 0);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("rejects reschedule to the same term and keeps state unchanged", async () => {
    const seed = await createSeed();
    const { prisma, reschedulePublicBookingByToken, EmailLogType } = await loadModules();

    try {
      await assert.rejects(
        reschedulePublicBookingByToken({
          token: seed.manageTokenRaw,
          slotId: seed.manageableCurrentSlotId,
          newStartAt: seed.manageableStartAt,
          expectedUpdatedAt: seed.manageableBookingUpdatedAt,
        }),
        (error: unknown) =>
          typeof error === "object"
          && error !== null
          && "code" in error
          && (error as { code: string }).code === "SAME_TERM",
      );

      const historyCount = await prisma.bookingRescheduleLog.count({
        where: {
          bookingId: seed.manageableBookingId,
        },
      });
      const emailCount = await prisma.emailLog.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: EmailLogType.BOOKING_RESCHEDULED,
        },
      });

      assert.equal(historyCount, 0);
      assert.equal(emailCount, 0);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("rejects reschedule outside the public online window", async () => {
    const seed = await createSeed();
    const { prisma, reschedulePublicBookingByToken, EmailLogType } = await loadModules();

    try {
      await assert.rejects(
        reschedulePublicBookingByToken({
          token: seed.manageTokenRaw,
          slotId: seed.outsideWindowSlotId,
          newStartAt: seed.outsideWindowStartAt,
          expectedUpdatedAt: seed.manageableBookingUpdatedAt,
        }),
        (error: unknown) =>
          typeof error === "object"
          && error !== null
          && "code" in error
          && (error as { code: string }).code === "SLOT_NOT_ALLOWED",
      );

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: seed.manageableBookingId },
        select: {
          slotId: true,
          scheduledStartsAt: true,
        },
      });

      assert.equal(booking.slotId, seed.manageableCurrentSlotId);
      assert.notEqual(booking.scheduledStartsAt.toISOString(), seed.outsideWindowStartAt);

      const historyCount = await prisma.bookingRescheduleLog.count({
        where: {
          bookingId: seed.manageableBookingId,
        },
      });
      const emailCount = await prisma.emailLog.count({
        where: {
          bookingId: seed.manageableBookingId,
          type: EmailLogType.BOOKING_RESCHEDULED,
        },
      });

      assert.equal(historyCount, 0);
      assert.equal(emailCount, 0);
    } finally {
      await cleanupSeed(seed);
    }
  });

  dbTest("rejects reschedule for bookings in terminal states", async () => {
    const seed = await createSeed();
    const { reschedulePublicBookingByToken } = await loadModules();

    try {
      const result = await reschedulePublicBookingByToken({
        token: seed.completedManageTokenRaw,
        slotId: seed.replacementSlotId,
        newStartAt: seed.replacementStartAt,
        expectedUpdatedAt: seed.manageableBookingUpdatedAt,
      });

      assert.equal(result.status, "not_reschedulable");
    } finally {
      await cleanupSeed(seed);
    }
  });
});
