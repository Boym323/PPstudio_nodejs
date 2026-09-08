import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { BookingStatus, Prisma } from "@/generated/prisma/client";

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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

type Seed = {
  actorUserId: string;
  bookingId: string;
  clientId: string;
  slotId: string;
  serviceId: string;
  categoryId: string;
  bookingEmail: string;
  approveRawToken?: string;
  rejectRawToken?: string;
};

async function loadModules() {
  const [{ prisma }, adminBookingModule, bookingEmailActionsModule, actionTokenModule, prismaClientModule, resendModule] =
    await Promise.all([
      import("@/lib/prisma"),
      import("@/features/admin/lib/admin-booking"),
      import("./booking-email-actions"),
      import("./booking-action-tokens"),
      import("@/generated/prisma/browser"),
      import("@/features/admin/actions/email-log-resend"),
    ]);

  return {
    prisma,
    applyAdminBookingStatusChange: adminBookingModule.applyAdminBookingStatusChange,
    performBookingEmailAction: bookingEmailActionsModule.performBookingEmailAction,
    buildBookingActionExpiry: actionTokenModule.buildBookingActionExpiry,
    buildBookingSelfServiceActionExpiry: actionTokenModule.buildBookingSelfServiceActionExpiry,
    buildBookingActionToken: actionTokenModule.buildBookingActionToken,
    hashBookingActionToken: actionTokenModule.hashBookingActionToken,
    createResendEmailLog: resendModule.createResendEmailLog,
    AdminRole: prismaClientModule.AdminRole,
    AvailabilitySlotStatus: prismaClientModule.AvailabilitySlotStatus,
    BookingActionTokenType: prismaClientModule.BookingActionTokenType,
    BookingSource: prismaClientModule.BookingSource,
    BookingStatus: prismaClientModule.BookingStatus,
    EmailAudience: prismaClientModule.EmailAudience,
    EmailLogStatus: prismaClientModule.EmailLogStatus,
    EmailLogType: prismaClientModule.EmailLogType,
  };
}

async function createSeed(options?: {
  withApproveToken?: boolean;
  withRejectToken?: boolean;
  startsAfterHours?: number;
}): Promise<Seed> {
  const {
    prisma,
    buildBookingActionExpiry,
    buildBookingActionToken,
    AdminRole,
    AvailabilitySlotStatus,
    BookingActionTokenType,
    BookingSource,
    BookingStatus,
  } = await loadModules();

  const suffix = randomUUID().slice(0, 8);
  const bookingEmail = `client-${suffix}@example.com`;
  const targetStartsAt = new Date(Date.now() + (options?.startsAfterHours ?? 7 * 24) * 60 * 60 * 1000);
  targetStartsAt.setUTCSeconds(0, 0);
  const startsAt = await findIsolatedSeedStart(prisma, targetStartsAt);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

  const actor = await prisma.adminUser.create({
    data: {
      email: `owner-${suffix}@example.com`,
      name: `Owner ${suffix}`,
      role: AdminRole.OWNER,
    },
    select: { id: true },
  });

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Kategorie ${suffix}`,
      slug: `kategorie-${suffix}`,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Služba ${suffix}`,
      slug: `sluzba-${suffix}`,
      durationMinutes: 60,
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
      publishedAt: new Date(),
      capacity: 1,
      createdByUserId: actor.id,
    },
    select: { id: true },
  });

  const client = await prisma.client.create({
    data: {
      fullName: `Klientka ${suffix}`,
      email: `master-client-${suffix}@example.com`,
      phone: "+420123456789",
    },
    select: { id: true },
  });

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: slot.id,
      serviceId: service.id,
      source: BookingSource.WEB,
      status: BookingStatus.PENDING,
      clientNameSnapshot: `Klientka ${suffix}`,
      clientEmailSnapshot: bookingEmail,
      clientPhoneSnapshot: "+420123456789",
      serviceNameSnapshot: `Služba ${suffix}`,
      serviceDurationMinutes: 60,
      scheduledStartsAt: startsAt,
      scheduledEndsAt: endsAt,
    },
    select: { id: true },
  });

  let approveRawToken: string | undefined;
  let rejectRawToken: string | undefined;

  if (options?.withApproveToken) {
    const approveToken = buildBookingActionToken();
    approveRawToken = approveToken.rawToken;

    await prisma.bookingActionToken.create({
      data: {
        bookingId: booking.id,
        type: BookingActionTokenType.APPROVE,
        tokenHash: approveToken.tokenHash,
        expiresAt: buildBookingActionExpiry(new Date(), 7),
      },
    });
  }

  if (options?.withRejectToken) {
    const rejectToken = buildBookingActionToken();
    rejectRawToken = rejectToken.rawToken;

    await prisma.bookingActionToken.create({
      data: {
        bookingId: booking.id,
        type: BookingActionTokenType.REJECT,
        tokenHash: rejectToken.tokenHash,
        expiresAt: buildBookingActionExpiry(new Date(), 7),
      },
    });
  }

  return {
    actorUserId: actor.id,
    bookingId: booking.id,
    clientId: client.id,
    slotId: slot.id,
    serviceId: service.id,
    categoryId: category.id,
    bookingEmail,
    approveRawToken,
    rejectRawToken,
  };
}

async function findIsolatedSeedStart(
  prisma: Awaited<ReturnType<typeof loadModules>>["prisma"],
  targetStartsAt: Date,
) {
  const searchStart = new Date(targetStartsAt.getTime() - 24 * 60 * 60 * 1000);
  const searchEnd = new Date(targetStartsAt.getTime() + 24 * 60 * 60 * 1000);
  const [slots, bookings] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where: { startsAt: { lt: searchEnd }, endsAt: { gt: searchStart } },
      select: { startsAt: true, endsAt: true },
    }),
    prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        scheduledStartsAt: { lt: searchEnd },
        OR: [
          { blockedUntil: { gt: searchStart } },
          { blockedUntil: null, scheduledEndsAt: { gt: searchStart } },
        ],
      },
      select: { scheduledStartsAt: true, blockedUntil: true, scheduledEndsAt: true },
    }),
  ]);

  for (let attempt = 0; attempt <= 96; attempt += 1) {
    const direction = attempt % 2 === 0 ? -1 : 1;
    const distance = Math.ceil(attempt / 2) * 30 * 60 * 1000;
    const startsAt = new Date(targetStartsAt.getTime() + direction * distance);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const slotConflict = slots.some((slot) => slot.startsAt < endsAt && slot.endsAt > startsAt);
    const bookingConflict = bookings.some((booking) => {
      const blockedUntil = booking.blockedUntil ?? booking.scheduledEndsAt;
      return booking.scheduledStartsAt < endsAt && blockedUntil > startsAt;
    });

    if (!slotConflict && !bookingConflict) {
      return startsAt;
    }
  }

  throw new Error("Nepodařilo se najít izolovaný seed termín pro booking e-mail integrační test.");
}

async function cleanupSeed(seed: Seed) {
  const { prisma } = await loadModules();

  await prisma.emailLog.deleteMany({ where: { bookingId: seed.bookingId } });
  await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: seed.bookingId } });
  await prisma.bookingActionToken.deleteMany({ where: { bookingId: seed.bookingId } });
  await prisma.booking.deleteMany({ where: { id: seed.bookingId } });
  await prisma.client.deleteMany({ where: { id: seed.clientId } });
  await prisma.availabilitySlot.deleteMany({ where: { id: seed.slotId } });
  await prisma.service.deleteMany({ where: { id: seed.serviceId } });
  await prisma.serviceCategory.deleteMany({ where: { id: seed.categoryId } });
  await prisma.adminUser.deleteMany({ where: { id: seed.actorUserId } });
}

async function removeClientEmail(seed: Seed) {
  const { prisma } = await loadModules();

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: seed.clientId },
      data: { email: null },
    });
    await tx.booking.update({
      where: { id: seed.bookingId },
      data: { clientEmailSnapshot: "" },
    });
  });
}

async function assertNoEmptyClientRecipients(bookingId: string) {
  const { prisma, EmailAudience } = await loadModules();
  const clientLogs = await prisma.emailLog.findMany({
    where: { bookingId, audience: EmailAudience.CLIENT },
    select: { recipientEmail: true },
  });

  assert.ok(clientLogs.every((emailLog) => emailLog.recipientEmail.trim().length > 0));
}

function assertApprovedEmailPayloadHasSelfServiceLinks(payload: unknown) {
  assert.equal(typeof payload, "object");
  assert.ok(payload && !Array.isArray(payload));
  const data = payload as Record<string, unknown>;
  assert.ok("manageReservationUrl" in data);
  assert.ok("cancellationUrl" in data);

  const typedData = data as {
    manageReservationUrl: string;
    cancellationUrl: string;
  };

  if (process.env.EMAIL_DELIVERY_MODE === "background") {
    assert.match(typedData.manageReservationUrl, /\/rezervace\/sprava\//);
    assert.match(typedData.cancellationUrl, /\/rezervace\/storno\//);
  } else {
    assert.equal(typedData.manageReservationUrl, "[REDACTED]");
    assert.equal(typedData.cancellationUrl, "[REDACTED]");
  }
}

dbTest("applyAdminBookingStatusChange stores manage and cancellation links in approved email payload", async () => {
  const seed = await createSeed();

  try {
    const {
      prisma,
      applyAdminBookingStatusChange,
      buildBookingSelfServiceActionExpiry,
    } = await loadModules();
    const result = await applyAdminBookingStatusChange({
      bookingId: seed.bookingId,
      targetStatus: "CONFIRMED",
      actorUserId: seed.actorUserId,
      notifyClient: true,
      reason: "Integration test confirmation",
      internalNote: undefined,
    });

    assert.deepEqual(result, { status: "success" });

    const emailLog = await prisma.emailLog.findFirst({
      where: {
        bookingId: seed.bookingId,
        templateKey: "booking-approved-v1",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        payload: true,
        recipientEmail: true,
      },
    });

    assert.ok(emailLog);
    assert.equal(emailLog.recipientEmail, seed.bookingEmail);
    assertApprovedEmailPayloadHasSelfServiceLinks(emailLog.payload);

    const [booking, actionTokens] = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: seed.bookingId },
        select: { scheduledStartsAt: true },
      }),
      prisma.bookingActionToken.findMany({
        where: { bookingId: seed.bookingId },
        select: { type: true, expiresAt: true },
      }),
    ]);

    assert.equal(actionTokens.length, 2);
    assert.ok(actionTokens.every(
      (token) => token.expiresAt.getTime() === buildBookingSelfServiceActionExpiry(booking.scheduledStartsAt).getTime(),
    ));
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("performBookingEmailAction approve stores manage and cancellation links in approved email payload", async () => {
  const seed = await createSeed({ withApproveToken: true });

  try {
    const {
      prisma,
      performBookingEmailAction,
      buildBookingSelfServiceActionExpiry,
      BookingActionTokenType,
    } = await loadModules();
    const result = await performBookingEmailAction(
      "approve",
      seed.approveRawToken!,
      {
        ipAddress: "127.0.0.1",
        userAgent: "integration-test",
      },
      {
        userId: seed.actorUserId,
      },
    );

    assert.equal(result.status, "completed");

    const emailLog = await prisma.emailLog.findFirst({
      where: {
        bookingId: seed.bookingId,
        templateKey: "booking-approved-v1",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        payload: true,
        recipientEmail: true,
      },
    });

    assert.ok(emailLog);
    assert.equal(emailLog.recipientEmail, seed.bookingEmail);
    assertApprovedEmailPayloadHasSelfServiceLinks(emailLog.payload);

    const [booking, actionTokens] = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: seed.bookingId },
        select: { scheduledStartsAt: true },
      }),
      prisma.bookingActionToken.findMany({
        where: {
          bookingId: seed.bookingId,
          type: { in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL] },
        },
        select: { expiresAt: true },
      }),
    ]);

    assert.equal(actionTokens.length, 2);
    assert.ok(actionTokens.every(
      (token) => token.expiresAt.getTime() === buildBookingSelfServiceActionExpiry(booking.scheduledStartsAt).getTime(),
    ));
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("owner approve 24 hodin před začátkem založí právě jeden reminder", async () => {
  const seed = await createSeed({ withApproveToken: true, startsAfterHours: 24 });

  try {
    const { prisma, performBookingEmailAction, EmailLogType } = await loadModules();
    const result = await performBookingEmailAction(
      "approve",
      seed.approveRawToken!,
      undefined,
      { userId: seed.actorUserId },
    );

    assert.equal(result.status, "completed");
    assert.equal(await prisma.emailLog.count({
      where: {
        bookingId: seed.bookingId,
        type: EmailLogType.BOOKING_REMINDER,
      },
    }), 1);
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("owner reject posílá CLIENT e-mail na snapshot rezervace, ne na master kontakt", async () => {
  const seed = await createSeed({ withRejectToken: true });

  try {
    const { prisma, performBookingEmailAction, EmailAudience, EmailLogType } = await loadModules();
    const result = await performBookingEmailAction(
      "reject",
      seed.rejectRawToken!,
      undefined,
      { userId: seed.actorUserId },
    );

    assert.equal(result.status, "completed");
    const emailLog = await prisma.emailLog.findFirstOrThrow({
      where: {
        bookingId: seed.bookingId,
        audience: EmailAudience.CLIENT,
        type: EmailLogType.BOOKING_CANCELLED,
      },
      select: { recipientEmail: true },
    });
    assert.equal(emailLog.recipientEmail, seed.bookingEmail);
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("owner approve/reject odmítne aktivní delivery lease a po expiraci zvýší generaci", async () => {
  const cases = [
    { intent: "approve" as const, option: { withApproveToken: true }, expectedStatus: "CONFIRMED" as const },
    { intent: "reject" as const, option: { withRejectToken: true }, expectedStatus: "CANCELLED" as const },
  ];

  for (const testCase of cases) {
    const seed = await createSeed(testCase.option);

    try {
      const { prisma, performBookingEmailAction, BookingStatus } = await loadModules();
      await prisma.booking.update({
        where: { id: seed.bookingId },
        data: {
          clientDeliveryLeaseToken: `owner-action-worker-${testCase.intent}`,
          clientDeliveryLeaseExpiresAt: new Date(Date.now() + 60 * 1000),
        },
      });

      const rawToken = testCase.intent === "approve" ? seed.approveRawToken : seed.rejectRawToken;
      const blocked = await performBookingEmailAction(
        testCase.intent,
        rawToken!,
        undefined,
        { userId: seed.actorUserId },
      );
      assert.equal(blocked.status, "concurrent_modification");
      assert.deepEqual(
        await prisma.booking.findUniqueOrThrow({
          where: { id: seed.bookingId },
          select: { status: true, communicationGeneration: true },
        }),
        { status: BookingStatus.PENDING, communicationGeneration: 1 },
      );

      await prisma.booking.update({
        where: { id: seed.bookingId },
        data: { clientDeliveryLeaseExpiresAt: new Date(0) },
      });

      const completed = await performBookingEmailAction(
        testCase.intent,
        rawToken!,
        undefined,
        { userId: seed.actorUserId },
      );
      assert.equal(completed.status, "completed");
      assert.deepEqual(
        await prisma.booking.findUniqueOrThrow({
          where: { id: seed.bookingId },
          select: { status: true, communicationGeneration: true },
        }),
        { status: BookingStatus[testCase.expectedStatus], communicationGeneration: 2 },
      );
    } finally {
      await cleanupSeed(seed);
    }
  }
});

dbTest("CLIENT lifecycle použije snapshot i při odstranění master e-mailu", async () => {
  const seed = await createSeed();

  try {
    const { prisma, applyAdminBookingStatusChange, BookingStatus, EmailAudience, EmailLogType } = await loadModules();
    await prisma.client.update({ where: { id: seed.clientId }, data: { email: null } });

    const result = await applyAdminBookingStatusChange({
      bookingId: seed.bookingId,
      targetStatus: BookingStatus.CONFIRMED,
      actorUserId: seed.actorUserId,
      notifyClient: true,
    });

    assert.equal(result.status, "success");
    const emailLog = await prisma.emailLog.findFirstOrThrow({
      where: {
        bookingId: seed.bookingId,
        audience: EmailAudience.CLIENT,
        type: EmailLogType.BOOKING_CONFIRMED,
      },
      select: { recipientEmail: true },
    });
    assert.equal(emailLog.recipientEmail, seed.bookingEmail);
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("prázdný booking snapshot přeskočí CLIENT log i self-service tokeny", async () => {
  const seed = await createSeed();

  try {
    const { prisma, applyAdminBookingStatusChange, BookingActionTokenType, BookingStatus, EmailAudience } = await loadModules();
    await prisma.booking.update({ where: { id: seed.bookingId }, data: { clientEmailSnapshot: "  " } });

    const result = await applyAdminBookingStatusChange({
      bookingId: seed.bookingId,
      targetStatus: BookingStatus.CONFIRMED,
      actorUserId: seed.actorUserId,
      notifyClient: true,
    });

    assert.equal(result.status, "success");
    assert.equal(
      await prisma.emailLog.count({ where: { bookingId: seed.bookingId, audience: EmailAudience.CLIENT } }),
      0,
    );
    assert.equal(
      await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.bookingId,
          type: { in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL] },
        },
      }),
      0,
    );
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: seed.bookingId }, select: { status: true } })).status,
      BookingStatus.CONFIRMED,
    );
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("další lifecycle po contact update použije nově synchronizovaný snapshot", async () => {
  const seed = await createSeed();
  const newEmail = `booking-contact-updated-${seed.bookingId}@example.com`;

  try {
    const { prisma, applyAdminBookingStatusChange, BookingStatus, EmailAudience, EmailLogType } = await loadModules();
    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: seed.clientId }, data: { email: newEmail } });
      await tx.booking.update({ where: { id: seed.bookingId }, data: { clientEmailSnapshot: newEmail } });
    });

    const result = await applyAdminBookingStatusChange({
      bookingId: seed.bookingId,
      targetStatus: BookingStatus.CONFIRMED,
      actorUserId: seed.actorUserId,
      notifyClient: true,
    });

    assert.equal(result.status, "success");
    const emailLog = await prisma.emailLog.findFirstOrThrow({
      where: { bookingId: seed.bookingId, audience: EmailAudience.CLIENT, type: EmailLogType.BOOKING_CONFIRMED },
      select: { recipientEmail: true },
    });
    assert.equal(emailLog.recipientEmail, newEmail);
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("admin CONFIRMED bez aktuálního e-mailu změní lifecycle bez klientského outboxu a tokenů", async () => {
  const seed = await createSeed();

  try {
    const { prisma, applyAdminBookingStatusChange, BookingActionTokenType, BookingStatus, EmailAudience } = await loadModules();
    await removeClientEmail(seed);

    const result = await applyAdminBookingStatusChange({
      bookingId: seed.bookingId,
      targetStatus: BookingStatus.CONFIRMED,
      actorUserId: seed.actorUserId,
      notifyClient: true,
    });

    assert.deepEqual(result, { status: "success" });
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: seed.bookingId }, select: { status: true } })).status,
      BookingStatus.CONFIRMED,
    );
    assert.equal(
      await prisma.emailLog.count({ where: { bookingId: seed.bookingId, audience: EmailAudience.CLIENT } }),
      0,
    );
    assert.equal(
      await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.bookingId,
          type: { in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL] },
        },
      }),
      0,
    );
    await assertNoEmptyClientRecipients(seed.bookingId);
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("owner approve a reject bez aktuálního e-mailu zachovají action token lifecycle bez klientského outboxu", async () => {
  const cases = [
    { intent: "approve" as const, tokenType: "APPROVE" as const, expectedStatus: "CONFIRMED" as const },
    { intent: "reject" as const, tokenType: "REJECT" as const, expectedStatus: "CANCELLED" as const },
  ];

  for (const testCase of cases) {
    const seed = await createSeed(
      testCase.intent === "approve" ? { withApproveToken: true } : { withRejectToken: true },
    );

    try {
      const {
        prisma,
        performBookingEmailAction,
        BookingActionTokenType,
        BookingStatus,
        EmailAudience,
      } = await loadModules();
      await removeClientEmail(seed);

      const rawToken = testCase.intent === "approve" ? seed.approveRawToken : seed.rejectRawToken;
      const result = await performBookingEmailAction(
        testCase.intent,
        rawToken!,
        undefined,
        { userId: seed.actorUserId },
      );

      assert.equal(result.status, "completed");
      if (result.status === "completed") {
        assert.equal(result.emailDeliveryStatus, "skipped");
      }
      assert.equal(
        (await prisma.booking.findUniqueOrThrow({ where: { id: seed.bookingId }, select: { status: true } })).status,
        BookingStatus[testCase.expectedStatus],
      );
      assert.equal(
        await prisma.emailLog.count({ where: { bookingId: seed.bookingId, audience: EmailAudience.CLIENT } }),
        0,
      );
      assert.equal(
        await prisma.bookingActionToken.count({
          where: {
            bookingId: seed.bookingId,
            type: { in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL] },
          },
        }),
        0,
      );
      const actionToken = await prisma.bookingActionToken.findFirstOrThrow({
        where: { bookingId: seed.bookingId, type: BookingActionTokenType[testCase.tokenType] },
        select: { usedAt: true },
      });
      assert.ok(actionToken.usedAt);
      await assertNoEmptyClientRecipients(seed.bookingId);
    } finally {
      await cleanupSeed(seed);
    }
  }
});

dbTest("rollback admin CONFIRMED vrátí lifecycle, action tokeny i klientský outbox atomicky", async () => {
  const seed = await createSeed();

  try {
    const { prisma, BookingActionTokenType, BookingStatus, EmailAudience } = await loadModules();
    const { applyAdminBookingStatusChangeInTransaction } = await import("@/features/admin/lib/admin-booking");

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const result = await applyAdminBookingStatusChangeInTransaction(tx, {
          bookingId: seed.bookingId,
          targetStatus: BookingStatus.CONFIRMED,
          actorUserId: seed.actorUserId,
          notifyClient: true,
        });
        assert.deepEqual(result, { status: "success" });
        throw new Error("rollback admin confirmation test");
      }),
      /rollback admin confirmation test/,
    );

    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: seed.bookingId }, select: { status: true } })).status,
      BookingStatus.PENDING,
    );
    assert.equal(
      await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.bookingId,
          type: { in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL] },
        },
      }),
      0,
    );
    assert.equal(
      await prisma.emailLog.count({ where: { bookingId: seed.bookingId, audience: EmailAudience.CLIENT } }),
      0,
    );
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("doplnění e-mailu přes contact rotation po potvrzení bez e-mailu vytvoří aktuální klientský log a tokeny", async () => {
  const seed = await createSeed();
  const newEmail = `rotated-${seed.bookingId}@example.com`;

  try {
    const { prisma, applyAdminBookingStatusChange, rotateClientBookingTokensForEmailChange } = await (async () => {
      const [{ prisma }, { applyAdminBookingStatusChange }, { rotateClientBookingTokensForEmailChange }] = await Promise.all([
        import("@/lib/prisma"),
        import("@/features/admin/lib/admin-booking"),
        import("@/features/admin/lib/client-contact-token-rotation"),
      ]);
      return { prisma, applyAdminBookingStatusChange, rotateClientBookingTokensForEmailChange };
    })();
    await removeClientEmail(seed);

    assert.deepEqual(await applyAdminBookingStatusChange({
      bookingId: seed.bookingId,
      targetStatus: "CONFIRMED",
      actorUserId: seed.actorUserId,
      notifyClient: true,
    }), { status: "success" });

    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: seed.clientId }, data: { email: newEmail } });
      await tx.booking.update({ where: { id: seed.bookingId }, data: { clientEmailSnapshot: newEmail } });
      await rotateClientBookingTokensForEmailChange(tx, {
        clientId: seed.clientId,
        bookingIds: [seed.bookingId],
        newEmail,
        now: new Date(),
      });
    });

    const { BookingActionTokenType, EmailAudience, EmailLogType } = await loadModules();
    const emailLog = await prisma.emailLog.findFirstOrThrow({
      where: { bookingId: seed.bookingId, audience: EmailAudience.CLIENT, type: EmailLogType.BOOKING_CONFIRMED },
      orderBy: { createdAt: "desc" },
      select: { recipientEmail: true },
    });
    assert.equal(emailLog.recipientEmail, newEmail);
    assert.equal(
      await prisma.bookingActionToken.count({
        where: {
          bookingId: seed.bookingId,
          type: { in: [BookingActionTokenType.RESCHEDULE, BookingActionTokenType.CANCEL] },
          revokedAt: null,
        },
      }),
      2,
    );
    await assertNoEmptyClientRecipients(seed.bookingId);
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("resend tokenového CLIENT e-mailu vydá nové tokeny a staré zneplatní", async () => {
  const seed = await createSeed();
  const {
    prisma,
    buildBookingActionExpiry,
    buildBookingSelfServiceActionExpiry,
    buildBookingActionToken,
    hashBookingActionToken,
    createResendEmailLog,
    BookingActionTokenType,
    EmailAudience,
    EmailLogStatus,
    EmailLogType,
  } = await loadModules();
  const now = new Date();
  const oldManageToken = buildBookingActionToken();
  const oldCancellationToken = buildBookingActionToken();

  try {
    await prisma.booking.update({
      where: { id: seed.bookingId },
      data: { status: "CONFIRMED" },
    });
    const bookingTerm = await prisma.booking.findUniqueOrThrow({
      where: { id: seed.bookingId },
      select: { scheduledStartsAt: true, scheduledEndsAt: true },
    });
    const oldManageRecord = await prisma.bookingActionToken.create({
      data: {
        bookingId: seed.bookingId,
        type: BookingActionTokenType.RESCHEDULE,
        tokenHash: oldManageToken.tokenHash,
        expiresAt: buildBookingActionExpiry(now),
      },
      select: { id: true },
    });
    await prisma.bookingActionToken.create({
      data: {
        bookingId: seed.bookingId,
        type: BookingActionTokenType.CANCEL,
        tokenHash: oldCancellationToken.tokenHash,
        expiresAt: buildBookingActionExpiry(now),
      },
    });
    const source = await prisma.emailLog.create({
      data: {
        bookingId: seed.bookingId,
        clientId: seed.clientId,
        actionTokenId: oldManageRecord.id,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.SENT,
        recipientEmail: "historical@example.com",
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: {
          bookingId: seed.bookingId,
          serviceName: "Původní služba",
          clientName: "Původní klientka",
          scheduledStartsAt: bookingTerm.scheduledStartsAt.toISOString(),
          scheduledEndsAt: bookingTerm.scheduledEndsAt.toISOString(),
          manageReservationUrl: `https://example.com/rezervace/sprava/${oldManageToken.rawToken}`,
          cancellationUrl: `https://example.com/rezervace/storno/${oldCancellationToken.rawToken}`,
          includeCalendarAttachment: true,
          auditValue: "zachovat",
        },
      },
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });

    const resend = await createResendEmailLog({ emailLog: sourceForResend });
    assert.ok(resend);
    const resendPayload = resend.payload as Record<string, unknown>;
    const newManageToken = String(resendPayload.manageReservationUrl).split("/").pop();
    const newCancellationToken = String(resendPayload.cancellationUrl).split("/").pop();

    assert.ok(newManageToken);
    assert.ok(newCancellationToken);
    assert.notEqual(newManageToken, oldManageToken.rawToken);
    assert.notEqual(newCancellationToken, oldCancellationToken.rawToken);
    assert.equal(resend.status, EmailLogStatus.PENDING);
    assert.equal(resend.actionTokenId !== null, true);
    assert.equal(resendPayload.auditValue, "zachovat");
    assert.ok(await prisma.bookingActionToken.findUnique({ where: { tokenHash: hashBookingActionToken(newManageToken) } }));
    assert.ok(await prisma.bookingActionToken.findUnique({ where: { tokenHash: hashBookingActionToken(newCancellationToken) } }));

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: seed.bookingId },
      select: { scheduledStartsAt: true },
    });
    const newActionTokens = await prisma.bookingActionToken.findMany({
      where: {
        bookingId: seed.bookingId,
        tokenHash: { in: [hashBookingActionToken(newManageToken), hashBookingActionToken(newCancellationToken)] },
      },
      select: { expiresAt: true },
    });
    assert.equal(newActionTokens.length, 2);
    assert.ok(newActionTokens.every(
      (token) => token.expiresAt.getTime() === buildBookingSelfServiceActionExpiry(booking.scheduledStartsAt).getTime(),
    ));

    const oldTokens = await prisma.bookingActionToken.findMany({
      where: { bookingId: seed.bookingId, tokenHash: { in: [oldManageToken.tokenHash, oldCancellationToken.tokenHash] } },
      select: { revokedAt: true },
    });
    assert.equal(oldTokens.length, 2);
    assert.ok(oldTokens.every((token) => token.revokedAt));
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("CLIENT resend při odstraněném e-mailu odmítne akci před token mutation", async () => {
  const seed = await createSeed();
  const {
    prisma,
    buildBookingActionExpiry,
    createResendEmailLog,
    BookingActionTokenType,
    EmailAudience,
    EmailLogStatus,
    EmailLogType,
  } = await loadModules();

  try {
    await prisma.booking.update({
      where: { id: seed.bookingId },
      data: { status: "CONFIRMED" },
    });
    const [client, booking] = await Promise.all([
      prisma.client.findUniqueOrThrow({ where: { id: seed.clientId }, select: { email: true } }),
      prisma.booking.findUniqueOrThrow({
        where: { id: seed.bookingId },
        select: { scheduledStartsAt: true, scheduledEndsAt: true, serviceId: true },
      }),
    ]);
    const oldTokens = await Promise.all([
      prisma.bookingActionToken.create({
        data: {
          bookingId: seed.bookingId,
          type: BookingActionTokenType.RESCHEDULE,
          tokenHash: `missing-email-manage-${seed.bookingId}`,
          expiresAt: buildBookingActionExpiry(new Date()),
        },
      }),
      prisma.bookingActionToken.create({
        data: {
          bookingId: seed.bookingId,
          type: BookingActionTokenType.CANCEL,
          tokenHash: `missing-email-cancel-${seed.bookingId}`,
          expiresAt: buildBookingActionExpiry(new Date()),
        },
      }),
    ]);
    const source = await prisma.emailLog.create({
      data: {
        bookingId: seed.bookingId,
        clientId: seed.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.SENT,
        recipientEmail: client.email!,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: {
          serviceId: booking.serviceId,
          scheduledStartsAt: booking.scheduledStartsAt.toISOString(),
          scheduledEndsAt: booking.scheduledEndsAt.toISOString(),
        },
      },
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: seed.clientId }, data: { email: null } });
      await tx.booking.update({ where: { id: seed.bookingId }, data: { clientEmailSnapshot: "" } });
    });

    assert.equal(await createResendEmailLog({ emailLog: sourceForResend }), null);
    assert.equal(await prisma.emailLog.count({ where: { resendOfId: source.id } }), 0);
    const tokens = await prisma.bookingActionToken.findMany({
      where: { id: { in: oldTokens.map((token) => token.id) } },
      select: { revokedAt: true },
    });
    assert.equal(tokens.length, 2);
    assert.ok(tokens.every((token) => token.revokedAt === null));
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("CLIENT resend po souběžné změně kontaktu použije nový e-mail i pro nové tokeny", async () => {
  const seed = await createSeed();
  const {
    prisma,
    createResendEmailLog,
    EmailAudience,
    EmailLogStatus,
    EmailLogType,
  } = await loadModules();
  const newEmail = `race-new-${seed.bookingId}@example.com`;
  const clientLockAcquired = deferred();
  const allowClientUpdate = deferred();
  let clientUpdatePromise: Promise<void> | null = null;

  try {
    await prisma.booking.update({
      where: { id: seed.bookingId },
      data: { status: "CONFIRMED" },
    });
    const [client, booking] = await Promise.all([
      prisma.client.findUniqueOrThrow({ where: { id: seed.clientId }, select: { email: true } }),
      prisma.booking.findUniqueOrThrow({
        where: { id: seed.bookingId },
        select: { scheduledStartsAt: true, scheduledEndsAt: true, serviceId: true },
      }),
    ]);
    const source = await prisma.emailLog.create({
      data: {
        bookingId: seed.bookingId,
        clientId: seed.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.SENT,
        recipientEmail: client.email!,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: {
          serviceId: booking.serviceId,
          scheduledStartsAt: booking.scheduledStartsAt.toISOString(),
          scheduledEndsAt: booking.scheduledEndsAt.toISOString(),
        },
      },
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });
    assert.equal(sourceForResend.client?.email, client.email);

    clientUpdatePromise = prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "Client"
        WHERE "id" = ${seed.clientId}
        FOR UPDATE
      `);
      clientLockAcquired.resolve();
      await allowClientUpdate.promise;
      await tx.client.update({ where: { id: seed.clientId }, data: { email: newEmail } });
      await tx.booking.update({ where: { id: seed.bookingId }, data: { clientEmailSnapshot: newEmail } });
    });

    await clientLockAcquired.promise;
    const resendStarted = deferred();
    const resendPromise = createResendEmailLog({
      emailLog: sourceForResend,
      hooks: {
        beforeClientLock: () => resendStarted.resolve(),
      },
    });
    await resendStarted.promise;
    allowClientUpdate.resolve();

    const [resend] = await Promise.all([resendPromise, clientUpdatePromise]);
    assert.ok(resend);
    assert.equal(resend.recipientEmail, newEmail);
    assert.notEqual(resend.recipientEmail, client.email);
    assert.equal(resend.actionTokenId !== null, true);
  } finally {
    allowClientUpdate.resolve();
    await clientUpdatePromise?.catch(() => undefined);
    await cleanupSeed(seed);
  }
});

dbTest("CLIENT resend rollbackne nové tokeny i jejich revokaci při chybě zápisu logu", async () => {
  const seed = await createSeed();
  const {
    prisma,
    buildBookingActionExpiry,
    createResendEmailLog,
    BookingActionTokenType,
    EmailAudience,
    EmailLogStatus,
    EmailLogType,
  } = await loadModules();

  try {
    await prisma.booking.update({
      where: { id: seed.bookingId },
      data: { status: "CONFIRMED" },
    });
    const [client, booking] = await Promise.all([
      prisma.client.findUniqueOrThrow({ where: { id: seed.clientId }, select: { email: true } }),
      prisma.booking.findUniqueOrThrow({
        where: { id: seed.bookingId },
        select: { scheduledStartsAt: true, scheduledEndsAt: true, serviceId: true },
      }),
    ]);
    const oldTokens = await Promise.all([
      prisma.bookingActionToken.create({
        data: {
          bookingId: seed.bookingId,
          type: BookingActionTokenType.RESCHEDULE,
          tokenHash: `rollback-manage-${seed.bookingId}`,
          expiresAt: buildBookingActionExpiry(new Date()),
        },
      }),
      prisma.bookingActionToken.create({
        data: {
          bookingId: seed.bookingId,
          type: BookingActionTokenType.CANCEL,
          tokenHash: `rollback-cancel-${seed.bookingId}`,
          expiresAt: buildBookingActionExpiry(new Date()),
        },
      }),
    ]);
    const source = await prisma.emailLog.create({
      data: {
        bookingId: seed.bookingId,
        clientId: seed.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.SENT,
        recipientEmail: client.email!,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: {
          serviceId: booking.serviceId,
          scheduledStartsAt: booking.scheduledStartsAt.toISOString(),
          scheduledEndsAt: booking.scheduledEndsAt.toISOString(),
        },
      },
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });

    await assert.rejects(
      createResendEmailLog({
        emailLog: sourceForResend,
        hooks: {
          afterTokenMutation: () => {
            throw new Error("rollback resend test");
          },
        },
      }),
      /rollback resend test/,
    );

    const tokens = await prisma.bookingActionToken.findMany({
      where: { bookingId: seed.bookingId },
      select: { id: true, revokedAt: true },
    });
    assert.equal(tokens.length, oldTokens.length);
    assert.deepEqual(
      new Set(tokens.map((token) => token.id)),
      new Set(oldTokens.map((token) => token.id)),
    );
    assert.ok(tokens.every((token) => token.revokedAt === null));
    assert.equal(await prisma.emailLog.count({ where: { resendOfId: source.id } }), 0);
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("resend tokenového ADMIN e-mailu vydá nové approve/reject tokeny", async () => {
  const seed = await createSeed();
  const {
    prisma,
    buildBookingActionExpiry,
    buildBookingActionToken,
    hashBookingActionToken,
    createResendEmailLog,
    BookingActionTokenType,
    EmailAudience,
    EmailLogStatus,
    EmailLogType,
  } = await loadModules();
  const now = new Date();
  const oldApproveToken = buildBookingActionToken();
  const oldRejectToken = buildBookingActionToken();

  try {
    await prisma.bookingActionToken.create({
      data: {
        bookingId: seed.bookingId,
        type: BookingActionTokenType.APPROVE,
        tokenHash: oldApproveToken.tokenHash,
        expiresAt: buildBookingActionExpiry(now, 7),
      },
    });
    await prisma.bookingActionToken.create({
      data: {
        bookingId: seed.bookingId,
        type: BookingActionTokenType.REJECT,
        tokenHash: oldRejectToken.tokenHash,
        expiresAt: buildBookingActionExpiry(now, 7),
      },
    });
    const source = await prisma.emailLog.create({
      data: {
        bookingId: seed.bookingId,
        clientId: seed.clientId,
        type: EmailLogType.BOOKING_CREATED,
        audience: EmailAudience.ADMIN,
        status: EmailLogStatus.SENT,
        recipientEmail: "admin@example.com",
        subject: "Nová rezervace",
        templateKey: "admin-booking-notification-v1",
        payload: {
          bookingId: seed.bookingId,
          serviceName: "Služba",
          clientName: "Klientka",
          clientEmail: "client@example.com",
          scheduledStartsAt: "2026-08-17T10:00:00.000Z",
          scheduledEndsAt: "2026-08-17T11:00:00.000Z",
          approveUrl: `https://example.com/rezervace/akce/approve/${oldApproveToken.rawToken}`,
          rejectUrl: `https://example.com/rezervace/akce/reject/${oldRejectToken.rawToken}`,
          adminUrl: "https://example.com/admin/rezervace/booking-1",
        },
      },
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });

    const resend = await createResendEmailLog({
      emailLog: sourceForResend,
      adminNotificationEmail: "admin@example.com",
    });
    assert.ok(resend);
    assert.equal(resend.recipientEmail, "admin@example.com");
    const resendPayload = resend.payload as Record<string, unknown>;
    const newApproveToken = String(resendPayload.approveUrl).split("/").pop();
    const newRejectToken = String(resendPayload.rejectUrl).split("/").pop();

    assert.ok(newApproveToken);
    assert.ok(newRejectToken);
    assert.notEqual(newApproveToken, oldApproveToken.rawToken);
    assert.notEqual(newRejectToken, oldRejectToken.rawToken);
    assert.ok(await prisma.bookingActionToken.findUnique({ where: { tokenHash: hashBookingActionToken(newApproveToken) } }));
    assert.ok(await prisma.bookingActionToken.findUnique({ where: { tokenHash: hashBookingActionToken(newRejectToken) } }));
    const newAdminTokens = await prisma.bookingActionToken.findMany({
      where: {
        bookingId: seed.bookingId,
        tokenHash: { in: [hashBookingActionToken(newApproveToken), hashBookingActionToken(newRejectToken)] },
      },
      select: { expiresAt: true, createdAt: true },
    });
    assert.equal(newAdminTokens.length, 2);
    assert.ok(newAdminTokens.every(
      (token) => Math.abs(
        token.expiresAt.getTime() - token.createdAt.getTime() - 7 * 24 * 60 * 60 * 1000,
      ) < 1_000,
    ));
    const oldTokens = await prisma.bookingActionToken.findMany({
      where: { bookingId: seed.bookingId, tokenHash: { in: [oldApproveToken.tokenHash, oldRejectToken.tokenHash] } },
      select: { revokedAt: true },
    });
    assert.equal(oldTokens.length, 2);
    assert.ok(oldTokens.every((token) => token.revokedAt));
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("performBookingEmailAction without admin actor does not change booking status", async () => {
  const seed = await createSeed({ withApproveToken: true });

  try {
    const { prisma, performBookingEmailAction, BookingStatus } = await loadModules();
    const result = await performBookingEmailAction("approve", seed.approveRawToken!, {
      ipAddress: "127.0.0.1",
      userAgent: "integration-test",
    });

    assert.equal(result.status, "auth_required");

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: seed.bookingId },
      select: { status: true },
    });
    const token = await prisma.bookingActionToken.findFirstOrThrow({
      where: { bookingId: seed.bookingId },
      select: { usedAt: true },
    });

    assert.equal(booking.status, BookingStatus.PENDING);
    assert.equal(token.usedAt, null);
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("performBookingEmailAction with admin actor records a user audit entry", async () => {
  const seed = await createSeed({ withApproveToken: true });

  try {
    const { prisma, performBookingEmailAction, BookingStatus } = await loadModules();
    const result = await performBookingEmailAction(
      "approve",
      seed.approveRawToken!,
      {
        ipAddress: "127.0.0.1",
        userAgent: "integration-test",
      },
      {
        userId: seed.actorUserId,
      },
    );

    assert.equal(result.status, "completed");

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: seed.bookingId },
      select: { status: true },
    });
    const history = await prisma.bookingStatusHistory.findFirstOrThrow({
      where: { bookingId: seed.bookingId, status: BookingStatus.CONFIRMED },
      select: { actorUserId: true, reason: true },
    });

    assert.equal(booking.status, BookingStatus.CONFIRMED);
    assert.equal(history.actorUserId, seed.actorUserId);
    assert.equal(history.reason, "owner-email-approve-v1");
  } finally {
    await cleanupSeed(seed);
  }
});

dbTest("performBookingEmailAction reject restores availability across an archived split slot", async () => {
  const seed = await createSeed({ withRejectToken: true });
  const { prisma, performBookingEmailAction, AvailabilitySlotStatus, BookingStatus } = await loadModules();
  const fragmentIds: string[] = [];

  try {
    const slot = await prisma.availabilitySlot.findUniqueOrThrow({
      where: { id: seed.slotId },
      select: { startsAt: true, endsAt: true },
    });
    const fragmentDuration = 30 * 60 * 1000;

    await prisma.availabilitySlot.update({
      where: { id: seed.slotId },
      data: { status: AvailabilitySlotStatus.ARCHIVED },
    });

    const fragments = await prisma.availabilitySlot.createManyAndReturn({
      data: [
        {
          startsAt: new Date(slot.startsAt.getTime() - fragmentDuration),
          endsAt: slot.startsAt,
          capacity: 1,
          status: AvailabilitySlotStatus.PUBLISHED,
          publishedAt: new Date(),
          serviceRestrictionMode: "ANY",
          createdByUserId: seed.actorUserId,
        },
        {
          startsAt: slot.endsAt,
          endsAt: new Date(slot.endsAt.getTime() + fragmentDuration),
          capacity: 1,
          status: AvailabilitySlotStatus.PUBLISHED,
          publishedAt: new Date(),
          serviceRestrictionMode: "ANY",
          createdByUserId: seed.actorUserId,
        },
      ],
      select: { id: true },
    });
    fragmentIds.push(...fragments.map((fragment) => fragment.id));

    const result = await performBookingEmailAction(
      "reject",
      seed.rejectRawToken!,
      undefined,
      { userId: seed.actorUserId },
    );

    assert.equal(result.status, "completed");

    const [booking, overlappingSlots, blockingBookings] = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: seed.bookingId },
        select: { status: true },
      }),
      prisma.availabilitySlot.findMany({
        where: {
          startsAt: { lt: slot.endsAt },
          endsAt: { gt: slot.startsAt },
        },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          bookings: {
            select: { id: true, status: true, manualOverride: true },
          },
        },
      }),
      prisma.booking.findMany({
        where: {
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledStartsAt: { lt: slot.endsAt },
          OR: [
            { blockedUntil: { gt: slot.startsAt } },
            { blockedUntil: null, scheduledEndsAt: { gt: slot.startsAt } },
          ],
        },
        select: { id: true, status: true, manualOverride: true },
      }),
    ]);

    assert.equal(booking.status, BookingStatus.CANCELLED);

    let coveredUntil = slot.startsAt.getTime();
    for (const publishedSlot of overlappingSlots.filter((item) => item.status === AvailabilitySlotStatus.PUBLISHED)) {
      if (publishedSlot.startsAt.getTime() <= coveredUntil) {
        coveredUntil = Math.max(coveredUntil, publishedSlot.endsAt.getTime());
      }
    }

    assert.ok(coveredUntil >= slot.endsAt.getTime(), "Původní interval musí být celý pokryt publikovanou dostupností.");
    assert.equal(
      overlappingSlots.some((item) => item.status === AvailabilitySlotStatus.DRAFT
        && item.bookings.some((bookingItem) => bookingItem.manualOverride && bookingItem.status === BookingStatus.CANCELLED)),
      false,
      "Osiřelý DRAFT slot ruční výjimky nesmí blokovat obnovenou dostupnost.",
    );
    assert.deepEqual(blockingBookings, []);
  } finally {
    await prisma.availabilitySlot.deleteMany({ where: { id: { in: fragmentIds } } });
    await cleanupSeed(seed);
  }
});
