import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BookingSource,
  BookingStatus,
  EmailAudience,
  EmailLogStatus,
  EmailLogType,
} from "@/generated/prisma/browser";
import { Prisma } from "@/generated/prisma/client";
import { getPragueLocalDate } from "@/features/booking/lib/booking-local-time";

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
  const [{ prisma }, bookingModule, workerModule, deliveryModule] = await Promise.all([
    import("@/lib/prisma"),
    import("./booking-public"),
    import("@/lib/email/worker"),
    import("@/lib/email/delivery"),
  ]);

  return {
    prisma,
    createManualBooking: bookingModule.createManualBooking,
    runEmailDeliveryWorkerOnce: workerModule.runEmailDeliveryWorkerOnce,
    runBookingReminderSchedulerOnce: workerModule.runBookingReminderSchedulerOnce,
    claimEmailLogForImmediateDelivery: deliveryModule.claimEmailLogForImmediateDelivery,
    deliverEmailLog: deliveryModule.deliverEmailLog,
  };
}

async function createPendingConfirmationEmailLog(seed: string) {
  const { prisma } = await loadModules();

  return prisma.emailLog.create({
    data: {
      type: EmailLogType.BOOKING_RECEIVED,
      status: EmailLogStatus.PENDING,
      recipientEmail: `delivery-${seed}@example.com`,
      subject: "Rezervace přijata",
      templateKey: "booking-confirmation-v1",
      payload: {
        bookingId: `delivery-${seed}`,
        serviceName: "Testovací služba",
        clientName: "Testovací klientka",
        scheduledStartsAt: "2026-08-17T10:00:00.000Z",
        scheduledEndsAt: "2026-08-17T11:00:00.000Z",
      },
    },
  });
}

async function createPendingTokenConfirmationEmailLog(seed: string) {
  const { prisma } = await loadModules();
  const manageToken = `raw-manage-token-${seed}`;
  const cancellationToken = `raw-cancellation-token-${seed}`;

  return {
    emailLog: await prisma.emailLog.create({
      data: {
        type: EmailLogType.BOOKING_RECEIVED,
        status: EmailLogStatus.PENDING,
        recipientEmail: `delivery-token-${seed}@example.com`,
        subject: "Rezervace přijata",
        templateKey: "booking-confirmation-v1",
        payload: {
          bookingId: `delivery-token-${seed}`,
          serviceName: "Testovací služba",
          clientName: "Testovací klientka",
          scheduledStartsAt: "2026-08-17T10:00:00.000Z",
          scheduledEndsAt: "2026-08-17T11:00:00.000Z",
          manageReservationUrl: `https://example.com/rezervace/sprava/${manageToken}`,
          cancellationUrl: `https://example.com/rezervace/storno/${cancellationToken}`,
          customAuditValue: "zachovat",
        },
      },
    }),
    manageToken,
    cancellationToken,
  };
}

function addMinutes(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

async function findIsolatedWorkerWindow(
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

  for (let dayStep = 0; dayStep < 45; dayStep += 1) {
    const dayOffset = 14 + ((daySeed + dayStep) % 45);

    for (const hour of hourCandidates) {
      for (const minute of minuteCandidates) {
        const startsAt = new Date();
        startsAt.setUTCSeconds(0, 0);
        startsAt.setUTCDate(startsAt.getUTCDate() + dayOffset);
        startsAt.setUTCHours(hour, minute, 0, 0);
        const endsAt = addMinutes(startsAt, durationMinutes);

        const [overlappingSlots, overlappingBookings] = await Promise.all([
          prisma.availabilitySlot.count({
            where: {
              startsAt: { lt: endsAt },
              endsAt: { gt: startsAt },
            },
          }),
          prisma.booking.count({
            where: {
              status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
              scheduledStartsAt: { lt: endsAt },
              OR: [
                { blockedUntil: { gt: startsAt } },
                { blockedUntil: null, scheduledEndsAt: { gt: startsAt } },
              ],
            },
          }),
        ]);

        if (overlappingSlots === 0 && overlappingBookings === 0) {
          return {
            startsAt,
            endsAt,
            reminderScanAt: addMinutes(startsAt, -(25 * 60 + 30)),
          };
        }
      }
    }
  }

  throw new Error("Nepodařilo se najít izolované okno pro worker integrační test.");
}

async function findIsolatedReminderAuthorizationWindow(
  prisma: Awaited<ReturnType<typeof loadModules>>["prisma"],
  durationMinutes: number,
) {
  // Delivery preflight smí pokračovat k autorizační bariéře jen u termínu
  // nejvýše 26 hodin dopředu. Běžná helper funkce hledá termíny nejdříve za
  // 14 dní, což je vhodné pro scheduler testy, ale zde by preflight skončil
  // dříve a test by čekal na nikdy neuvolněnou bariéru. Hledáme omezené okno
  // od aktuálního booking min-advance do 26 hodin, aby test nebyl závislý na konkrétním DEV booking v
  // části reminder window. Service-change může prodloužit službu o 30 minut;
  // reschedule test si vytváří druhý slot sám.
  const searchDurationMinutes = durationMinutes + (durationMinutes === 60 ? 30 : 0);
  const policy = await prisma.siteSettings.findUnique({
    where: { id: "site-settings" },
    select: { bookingMinAdvanceHours: true },
  });
  const searchStartMinutes = Math.max(60, (policy?.bookingMinAdvanceHours ?? 2) * 60);
  const maxAttempts = Math.floor((26 * 60 - searchStartMinutes) / 5);

  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    const startsAt = new Date(Date.now() + (searchStartMinutes + attempt * 5) * 60 * 1000);
    startsAt.setUTCSeconds(0, 0);
    const searchEndsAt = addMinutes(startsAt, searchDurationMinutes);

    const [overlappingSlots, overlappingBookings] = await Promise.all([
      prisma.availabilitySlot.count({
        where: {
          startsAt: { lt: searchEndsAt },
          endsAt: { gt: startsAt },
        },
      }),
      prisma.booking.count({
        where: {
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          scheduledStartsAt: { lt: searchEndsAt },
          OR: [
            { blockedUntil: { gt: startsAt } },
            { blockedUntil: null, scheduledEndsAt: { gt: startsAt } },
          ],
        },
      }),
    ]);

    if (overlappingSlots === 0 && overlappingBookings === 0) {
      return { startsAt, endsAt: addMinutes(startsAt, durationMinutes) };
    }
  }

  throw new Error("Nepodařilo se najít izolované reminder window pro autorizační test.");
}

async function createConfirmedManualBooking(
  seed: string,
  startsAt: Date,
  options: { preserveAutoReminder?: boolean } = {},
) {
  const { prisma, createManualBooking } = await loadModules();
  const endsAt = addMinutes(startsAt, 60);
  const phone = `+4207${String(Number.parseInt(seed, 16) % 100_000_000).padStart(8, "0")}`;

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Worker category ${seed}`,
      slug: `worker-category-${seed}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Worker service ${seed}`,
      slug: `worker-service-${seed}`,
      durationMinutes: 60,
      priceFromCzk: 1350,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });

  let result;

  try {
    result = await createManualBooking({
      serviceId: service.id,
      allowManualOverride: true,
      startsAt: startsAt.toISOString(),
      fullName: `Worker klientka ${seed}`,
      email: `worker-${seed}@example.com`,
      phone,
      source: BookingSource.PHONE,
      status: BookingStatus.CONFIRMED,
      actorUserId: null,
      sendClientEmail: false,
      includeCalendarAttachment: false,
    });
  } catch (error) {
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
    throw error;
  }

  if (!options.preserveAutoReminder) {
    await prisma.$transaction([
      prisma.emailLog.deleteMany({
        where: {
          bookingId: result.bookingId,
          type: EmailLogType.BOOKING_REMINDER,
        },
      }),
      prisma.booking.update({
        where: { id: result.bookingId },
        data: {
          reminder24hQueuedAt: null,
          reminder24hSentAt: null,
        },
      }),
    ]);
  }

  return {
    bookingId: result.bookingId,
    categoryId: category.id,
    serviceId: service.id,
    slotId: await prisma.booking.findUniqueOrThrow({
      where: { id: result.bookingId },
      select: { slotId: true },
    }).then((booking) => booking.slotId),
    startsAt,
    endsAt,
    email: `worker-${seed}@example.com`,
  };
}

async function cleanupBookingFixture({
  bookingId,
  serviceId,
  categoryId,
  slotId,
  email,
}: {
  bookingId: string;
  serviceId: string;
  categoryId: string;
  slotId: string;
  email: string;
}) {
  const { prisma } = await loadModules();

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
  await prisma.client.deleteMany({
    where: { email },
  });
  await prisma.availabilitySlot.deleteMany({
    where: {
      id: slotId,
    },
  });
  await prisma.service.deleteMany({
    where: { id: serviceId },
  });
  await prisma.serviceCategory.deleteMany({
    where: { id: categoryId },
  });
}

type BookingEmailFixture = Awaited<ReturnType<typeof createConfirmedManualBooking>>;

function buildBookingEmailPayload(
  fixture: BookingEmailFixture,
  overrides: Prisma.InputJsonObject = {},
) {
  return {
    bookingId: fixture.bookingId,
    serviceId: fixture.serviceId,
    serviceName: `Worker service ${fixture.bookingId}`,
    clientName: `Worker klientka ${fixture.bookingId}`,
    scheduledStartsAt: fixture.startsAt.toISOString(),
    scheduledEndsAt: fixture.endsAt.toISOString(),
    previousStartsAt: addMinutes(fixture.startsAt, -60).toISOString(),
    previousEndsAt: fixture.startsAt.toISOString(),
    clientEmail: fixture.email,
    manageReservationUrl: "https://example.com/rezervace/sprava/test-token",
    cancellationUrl: "https://example.com/rezervace/storno/test-token",
    adminUrl: `https://example.com/admin/rezervace/${fixture.bookingId}`,
    includeCalendarAttachment: false,
    ...overrides,
  } satisfies Prisma.InputJsonObject;
}

async function createAlternativeService(fixture: BookingEmailFixture, seed: string) {
  const { prisma } = await loadModules();

  return prisma.service.create({
    data: {
      categoryId: fixture.categoryId,
      name: `Worker alternative service ${seed}`,
      slug: `worker-alternative-service-${seed}`,
      durationMinutes: 60,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true, name: true },
  });
}

async function createPendingBookingEmailLog(
  fixture: BookingEmailFixture,
  input: {
    type: EmailLogType;
    templateKey: string;
    audience?: EmailAudience;
    clientId?: string;
    communicationGeneration?: number;
    payload?: Prisma.InputJsonObject;
  },
) {
  const { prisma } = await loadModules();

  return prisma.emailLog.create({
    data: {
      bookingId: fixture.bookingId,
      clientId: input.clientId ?? null,
      type: input.type,
      audience: input.audience ?? EmailAudience.CLIENT,
      status: EmailLogStatus.PENDING,
      recipientEmail: fixture.email,
      subject: "Testovací booking e-mail",
      templateKey: input.templateKey,
      payload: input.payload ?? buildBookingEmailPayload(fixture),
      communicationGeneration: input.communicationGeneration,
      nextAttemptAt: new Date(0),
    },
  });
}

function createBarrier() {
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    entered: enteredPromise,
    release,
    wait: async () => {
      entered();
      await releasePromise;
    },
  };
}

dbTest("deliverEmailLog po úspěšném Resend delivery provede reconciliation a vrátí sent", async () => {
  const seed = randomUUID();
  const {
    prisma,
    claimEmailLogForImmediateDelivery,
    deliverEmailLog,
  } = await loadModules();
  const emailLog = await createPendingConfirmationEmailLog(seed);
  const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
  const reconciledMessageIds: string[] = [];

  assert.ok(processingToken);
  try {
    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "resend", messageId: `resend-${seed}` }),
      reconcileUnmatchedResendWebhookEvents: async (messageId) => {
        reconciledMessageIds.push(messageId);
        return { reconciled: 0, candidates: 0 };
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.deepEqual(result, { status: "sent" });
    assert.deepEqual(reconciledMessageIds, [`resend-${seed}`]);
    assert.equal(stored.status, EmailLogStatus.SENT);
    assert.equal(stored.providerMessageId, `resend-${seed}`);
  } finally {
    await prisma.emailLog.deleteMany({ where: { id: emailLog.id } });
  }
});

dbTest("PENDING token email před odesláním zachová URL a po SENT je rediguje", async () => {
  const seed = randomUUID();
  const {
    prisma,
    claimEmailLogForImmediateDelivery,
    deliverEmailLog,
  } = await loadModules();
  const { emailLog, manageToken, cancellationToken } = await createPendingTokenConfirmationEmailLog(seed);
  const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);

  assert.ok(processingToken);
  try {
    const pending = await prisma.emailLog.findUniqueOrThrow({
      where: { id: emailLog.id },
      select: { payload: true },
    });
    const pendingPayload = pending.payload as Record<string, unknown>;
    assert.match(String(pendingPayload.manageReservationUrl), new RegExp(manageToken));
    assert.match(String(pendingPayload.cancellationUrl), new RegExp(cancellationToken));

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "resend", messageId: `resend-${seed}` }),
      reconcileUnmatchedResendWebhookEvents: async () => ({ reconciled: 0, candidates: 0 }),
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({
      where: { id: emailLog.id },
      select: { status: true, payload: true },
    });
    const sentPayload = stored.payload as Record<string, unknown>;

    assert.deepEqual(result, { status: "sent" });
    assert.equal(sentPayload.manageReservationUrl, "[REDACTED]");
    assert.equal(sentPayload.cancellationUrl, "[REDACTED]");
    assert.equal(sentPayload.customAuditValue, "zachovat");
  } finally {
    await prisma.emailLog.deleteMany({ where: { id: emailLog.id } });
  }
});

dbTest("deliverEmailLog zachová SENT a neaktivuje retry, když reconciliation po Resend delivery selže", async () => {
  const seed = randomUUID();
  const {
    prisma,
    claimEmailLogForImmediateDelivery,
    deliverEmailLog,
  } = await loadModules();
  const emailLog = await createPendingConfirmationEmailLog(seed);
  const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];

  assert.ok(processingToken);
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "resend", messageId: `resend-${seed}` }),
      reconcileUnmatchedResendWebhookEvents: async () => {
        throw new Error("simulated reconciliation failure");
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.deepEqual(result, { status: "sent" });
    assert.equal(stored.status, EmailLogStatus.SENT);
    assert.equal(stored.processingToken, null);
    assert.equal(stored.errorMessage, null);
    assert.equal(stored.attemptCount, 1);
    assert.deepEqual(logs, [[
      "Resend webhook reconciliation failed after successful delivery",
      {
        emailLogId: emailLog.id,
        providerMessageId: `resend-${seed}`,
        operation: "reconcile-unmatched-resend-webhook-events",
        errorName: "Error",
      },
    ]]);
  } finally {
    console.error = originalConsoleError;
    await prisma.emailLog.deleteMany({ where: { id: emailLog.id } });
  }
});

dbTest("selhání reconciliation neblokuje označení booking reminderu jako odeslaného", async () => {
  const seed = randomUUID().slice(0, 8);
  const {
    prisma,
    claimEmailLogForImmediateDelivery,
    deliverEmailLog,
  } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const reminderStartsAt = addMinutes(new Date(), 120);
  const reminderEndsAt = addMinutes(reminderStartsAt, 60);
  await prisma.booking.update({
    where: { id: fixture.bookingId },
    data: { scheduledStartsAt: reminderStartsAt, scheduledEndsAt: reminderEndsAt },
  });
  const emailLog = await prisma.emailLog.create({
    data: {
      bookingId: fixture.bookingId,
      type: EmailLogType.BOOKING_REMINDER,
      status: EmailLogStatus.PENDING,
      recipientEmail: fixture.email,
      subject: "Zítra se na vás těšíme v PP Studiu",
      templateKey: "booking-reminder-24h-v1",
      payload: {
        bookingId: fixture.bookingId,
        serviceName: `Worker service ${seed}`,
        clientName: `Worker klientka ${seed}`,
        scheduledStartsAt: reminderStartsAt.toISOString(),
        scheduledEndsAt: reminderEndsAt.toISOString(),
        manageReservationUrl: "https://example.com/rezervace/sprava/test-token",
        cancellationUrl: "https://example.com/rezervace/storno/test-token",
        manualReminderResend: true,
      },
    },
  });
  const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);

  assert.ok(processingToken);
  try {
    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "resend", messageId: `resend-${seed}` }),
      reconcileUnmatchedResendWebhookEvents: async () => {
        throw new Error("simulated reconciliation failure");
      },
    });
    const [storedEmailLog, booking] = await Promise.all([
      prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } }),
      prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } }),
    ]);

    assert.deepEqual(result, { status: "sent" });
    assert.equal(storedEmailLog.status, EmailLogStatus.SENT);
    assert.ok(booking.reminder24hSentAt);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("manual reminder resend ignoruje jen dřívější odeslání a provider retry zůstává funkční", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const startsAt = addMinutes(new Date(), 120);
  const endsAt = addMinutes(startsAt, 60);

  try {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { scheduledStartsAt: startsAt, scheduledEndsAt: endsAt, reminder24hSentAt: new Date() },
    });
    const emailLog = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId, type: EmailLogType.BOOKING_REMINDER, status: EmailLogStatus.PENDING,
        recipientEmail: fixture.email, subject: "Reminder", templateKey: "booking-reminder-24h-v1",
        payload: {
          bookingId: fixture.bookingId,
          serviceName: `Worker service ${seed}`,
          clientName: `Worker klientka ${seed}`,
          scheduledStartsAt: startsAt.toISOString(),
          scheduledEndsAt: endsAt.toISOString(),
          manageReservationUrl: "https://example.com/rezervace/sprava/test-token",
          cancellationUrl: "https://example.com/rezervace/storno/test-token",
          manualReminderResend: true,
        },
      },
    });
    const firstClaim = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(firstClaim);
    assert.equal((await deliverEmailLog(emailLog.id, firstClaim, {
      sendEmail: async () => { throw new Error("provider unavailable"); },
    })).status, "failed");
    await prisma.emailLog.update({ where: { id: emailLog.id }, data: { nextAttemptAt: new Date(0) } });
    const retryClaim = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(retryClaim);
    assert.deepEqual(await deliverEmailLog(emailLog.id, retryClaim, {
      sendEmail: async () => ({ provider: "log", messageId: `reminder-retry-${seed}` }),
    }), { status: "sent" });
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("manual reminder resend po přesunu nebo stornu systémově přeskočí starý termín", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const startsAt = addMinutes(new Date(), 120);
  const endsAt = addMinutes(startsAt, 60);

  try {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { scheduledStartsAt: startsAt, scheduledEndsAt: endsAt },
    });
    const rescheduledLog = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId, type: EmailLogType.BOOKING_REMINDER, status: EmailLogStatus.PENDING,
        recipientEmail: fixture.email, subject: "Reminder", templateKey: "booking-reminder-24h-v1",
        payload: { scheduledStartsAt: startsAt.toISOString(), scheduledEndsAt: endsAt.toISOString(), manualReminderResend: true },
      },
    });
    const movedStartsAt = addMinutes(startsAt, 60);
    await prisma.booking.update({ where: { id: fixture.bookingId }, data: { scheduledStartsAt: movedStartsAt, scheduledEndsAt: addMinutes(movedStartsAt, 60) } });
    const rescheduledClaim = await claimEmailLogForImmediateDelivery(rescheduledLog.id);
    assert.ok(rescheduledClaim);
    assert.equal((await deliverEmailLog(rescheduledLog.id, rescheduledClaim, {
      sendEmail: async () => ({ provider: "log", messageId: "must-not-send" }),
    })).status, "skipped");

    const cancelledLog = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId, type: EmailLogType.BOOKING_REMINDER, status: EmailLogStatus.PENDING,
        recipientEmail: fixture.email, subject: "Reminder", templateKey: "booking-reminder-24h-v1",
        payload: { scheduledStartsAt: movedStartsAt.toISOString(), scheduledEndsAt: addMinutes(movedStartsAt, 60).toISOString(), manualReminderResend: true },
      },
    });
    await prisma.booking.update({ where: { id: fixture.bookingId }, data: { status: BookingStatus.CANCELLED } });
    const cancelledClaim = await claimEmailLogForImmediateDelivery(cancelledLog.id);
    assert.ok(cancelledClaim);
    assert.equal((await deliverEmailLog(cancelledLog.id, cancelledClaim, {
      sendEmail: async () => ({ provider: "log", messageId: "must-not-send" }),
    })).status, "skipped");
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("selhání sendEmail před SENT zachová retry behavior delivery workeru", async () => {
  const seed = randomUUID();
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const emailLog = await prisma.emailLog.create({
    data: {
      type: EmailLogType.BOOKING_RECEIVED,
      status: EmailLogStatus.PENDING,
      recipientEmail: `delivery-failed-${seed}@example.com`,
      subject: "Rezervace přijata",
      templateKey: "booking-confirmation-v1",
      payload: {
        bookingId: `delivery-failed-${seed}`,
        serviceName: "Testovací služba",
        clientName: "Testovací klientka",
        scheduledStartsAt: "2026-08-17T10:00:00.000Z",
        scheduledEndsAt: "2026-08-17T11:00:00.000Z",
        manageReservationUrl: `https://example.com/rezervace/sprava/raw-failed-${seed}`,
        cancellationUrl: `https://example.com/rezervace/storno/raw-failed-${seed}`,
      },
    },
  });
  const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);

  assert.ok(processingToken);
  try {
    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => {
        throw new Error("simulated transport failure");
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.equal(result.status, "failed");
    assert.equal(result.errorMessage, "simulated transport failure");
    assert.equal(stored.status, EmailLogStatus.PENDING);
    assert.equal(stored.processingToken, null);
    assert.equal(stored.providerMessageId, null);
    assert.equal(stored.errorMessage, "simulated transport failure");
    const failedPayload = stored.payload as Record<string, unknown>;
    assert.match(String(failedPayload.manageReservationUrl), /raw-failed-/);
    assert.match(String(failedPayload.cancellationUrl), /raw-failed-/);
  } finally {
    await prisma.emailLog.deleteMany({ where: { id: emailLog.id } });
  }
});

dbTest("poslední neúspěšný pokus označí log jako FAILED a atomicky rediguje bearer URL", async () => {
  const seed = randomUUID();
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const emailLog = await prisma.emailLog.create({
    data: {
      type: EmailLogType.BOOKING_RECEIVED,
      status: EmailLogStatus.PENDING,
      attemptCount: 4,
      recipientEmail: `delivery-terminal-failed-${seed}@example.com`,
      subject: "Rezervace přijata",
      templateKey: "booking-confirmation-v1",
      payload: {
        bookingId: `delivery-terminal-failed-${seed}`,
        serviceName: "Testovací služba",
        clientName: "Testovací klientka",
        scheduledStartsAt: "2026-08-17T10:00:00.000Z",
        scheduledEndsAt: "2026-08-17T11:00:00.000Z",
        manageReservationUrl: `https://example.com/rezervace/sprava/raw-terminal-${seed}`,
        cancellationUrl: `https://example.com/rezervace/storno/raw-terminal-${seed}`,
        approveUrl: `https://example.com/admin/approve/raw-terminal-${seed}`,
        rejectUrl: `https://example.com/admin/reject/raw-terminal-${seed}`,
        customAuditValue: "zachovat",
      },
    },
  });
  const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);

  assert.ok(processingToken);
  try {
    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => {
        throw new Error("simulated terminal transport failure");
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({
      where: { id: emailLog.id },
      select: { status: true, attemptCount: true, payload: true },
    });
    const payload = stored.payload as Record<string, unknown>;

    assert.equal(result.status, "failed");
    assert.equal(stored.status, EmailLogStatus.FAILED);
    assert.equal(stored.attemptCount, 5);
    assert.equal(payload.manageReservationUrl, "[REDACTED]");
    assert.equal(payload.cancellationUrl, "[REDACTED]");
    assert.equal(payload.approveUrl, "[REDACTED]");
    assert.equal(payload.rejectUrl, "[REDACTED]");
    assert.equal(payload.customAuditValue, "zachovat");
  } finally {
    await prisma.emailLog.deleteMany({ where: { id: emailLog.id } });
  }
});

dbTest("resend aktuálního FAILED booking e-mailu vydá nové tokeny a nový payload", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma } = await loadModules();
  const { createResendEmailLog } = await import("@/features/admin/actions/email-log-resend");
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);

  try {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { clientId: true },
    });
    const oldTokens = await Promise.all([
      prisma.bookingActionToken.create({
        data: {
          bookingId: fixture.bookingId,
          type: "RESCHEDULE",
          tokenHash: `old-manage-${seed}`,
          expiresAt: addMinutes(new Date(), 60),
        },
      }),
      prisma.bookingActionToken.create({
        data: {
          bookingId: fixture.bookingId,
          type: "CANCEL",
          tokenHash: `old-cancel-${seed}`,
          expiresAt: addMinutes(new Date(), 60),
        },
      }),
    ]);
    const source = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId,
        clientId: booking.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.FAILED,
        recipientEmail: fixture.email,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: {
          bookingId: fixture.bookingId,
          serviceName: `Worker service ${fixture.bookingId}`,
          clientName: `Worker klientka ${fixture.bookingId}`,
          scheduledStartsAt: fixture.startsAt.toISOString(),
          scheduledEndsAt: fixture.endsAt.toISOString(),
          manageReservationUrl: "[REDACTED]",
          cancellationUrl: "[REDACTED]",
          customAuditValue: "zachovat",
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
    assert.equal(resend.status, EmailLogStatus.PENDING);
    const resendPayload = resend.payload as Record<string, unknown>;
    assert.match(String(resendPayload.manageReservationUrl), /\/rezervace\/sprava\//);
    assert.match(String(resendPayload.cancellationUrl), /\/rezervace\/storno\//);
    assert.notEqual(resendPayload.manageReservationUrl, "[REDACTED]");
    assert.notEqual(resendPayload.cancellationUrl, "[REDACTED]");
    assert.equal(resendPayload.serviceId, fixture.serviceId);
    assert.equal(resendPayload.customAuditValue, "zachovat");
    const tokenStates = await prisma.bookingActionToken.findMany({
      where: { bookingId: fixture.bookingId },
      select: { id: true, revokedAt: true },
    });
    assert.ok(tokenStates.find((token) => token.id === oldTokens[0].id)?.revokedAt);
    assert.ok(tokenStates.find((token) => token.id === oldTokens[1].id)?.revokedAt);
    assert.equal(tokenStates.filter((token) => token.revokedAt === null).length, 2);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("tokenizovaný CLIENT resend použije booking snapshot místo master e-mailu", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma } = await loadModules();
  const { createResendEmailLog } = await import("@/features/admin/actions/email-log-resend");
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const masterEmail = "master-" + seed + "@example.com";

  try {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { clientId: true },
    });
    const source = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId,
        clientId: booking.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.FAILED,
        recipientEmail: fixture.email,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: buildBookingEmailPayload(fixture, {
          manageReservationUrl: "[REDACTED]",
          cancellationUrl: "[REDACTED]",
        }),
      },
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });
    await prisma.client.update({
      where: { id: booking.clientId },
      data: { email: masterEmail },
    });

    const resend = await createResendEmailLog({ emailLog: sourceForResend });

    assert.ok(resend);
    assert.equal(resend.recipientEmail, fixture.email);
  } finally {
    await prisma.client.updateMany({
      where: { email: masterEmail },
      data: { email: fixture.email },
    });
    await cleanupBookingFixture(fixture);
  }
});

dbTest("tokenizovaný CLIENT resend posune pending reminder na novou generaci a nové odkazy", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma } = await loadModules();
  const { createResendEmailLog } = await import("@/features/admin/actions/email-log-resend");
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const oldManageUrl = `https://example.com/rezervace/sprava/old-manage-${seed}`;
  const oldCancellationUrl = `https://example.com/rezervace/storno/old-cancel-${seed}`;

  try {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { clientId: true },
    });
    const oldTokens = await Promise.all([
      prisma.bookingActionToken.create({
        data: { bookingId: fixture.bookingId, type: "RESCHEDULE", tokenHash: `old-manage-${seed}`, expiresAt: addMinutes(new Date(), 60) },
      }),
      prisma.bookingActionToken.create({
        data: { bookingId: fixture.bookingId, type: "CANCEL", tokenHash: `old-cancel-${seed}`, expiresAt: addMinutes(new Date(), 60) },
      }),
    ]);
    const source = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_CONFIRMED,
      templateKey: "booking-approved-v1",
      clientId: booking.clientId,
    });
    const reminder = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_REMINDER,
      templateKey: "booking-reminder-24h-v1",
      clientId: booking.clientId,
      payload: buildBookingEmailPayload(fixture, {
        manageReservationUrl: oldManageUrl,
        cancellationUrl: oldCancellationUrl,
      }),
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });

    const resend = await createResendEmailLog({ emailLog: sourceForResend });
    const [currentBooking, currentReminder, tokens] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId }, select: { communicationGeneration: true } }),
      prisma.emailLog.findUniqueOrThrow({ where: { id: reminder.id } }),
      prisma.bookingActionToken.findMany({ where: { id: { in: oldTokens.map((token) => token.id) } }, select: { revokedAt: true } }),
    ]);
    const reminderPayload = currentReminder.payload as Record<string, unknown>;

    assert.ok(resend);
    assert.equal(currentBooking.communicationGeneration, 2);
    assert.equal(currentReminder.status, EmailLogStatus.PENDING);
    assert.equal(currentReminder.communicationGeneration, 2);
    assert.notEqual(reminderPayload.manageReservationUrl, oldManageUrl);
    assert.notEqual(reminderPayload.cancellationUrl, oldCancellationUrl);
    assert.ok(tokens.every((token) => token.revokedAt));
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("tokenizovaný resend zneplatní claimnutý reminder před finální autorizací", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const { createResendEmailLog } = await import("@/features/admin/actions/email-log-resend");
  const window = await findIsolatedReminderAuthorizationWindow(prisma, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const oldManageUrl = `https://example.com/rezervace/sprava/old-manage-${seed}`;
  const oldCancellationUrl = `https://example.com/rezervace/storno/old-cancel-${seed}`;

  try {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { clientId: true },
    });
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { communicationGeneration: 8 },
    });
    const oldTokens = await Promise.all([
      prisma.bookingActionToken.create({
        data: { bookingId: fixture.bookingId, type: "RESCHEDULE", tokenHash: `old-manage-${seed}`, expiresAt: addMinutes(new Date(), 60) },
      }),
      prisma.bookingActionToken.create({
        data: { bookingId: fixture.bookingId, type: "CANCEL", tokenHash: `old-cancel-${seed}`, expiresAt: addMinutes(new Date(), 60) },
      }),
    ]);
    const source = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId,
        clientId: booking.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.FAILED,
        recipientEmail: fixture.email,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: buildBookingEmailPayload(fixture, {
          manageReservationUrl: oldManageUrl,
          cancellationUrl: oldCancellationUrl,
        }),
        communicationGeneration: 8,
      },
    });
    const reminder = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_REMINDER,
      templateKey: "booking-reminder-24h-v1",
      clientId: booking.clientId,
      communicationGeneration: 8,
      payload: buildBookingEmailPayload(fixture, {
        manageReservationUrl: oldManageUrl,
        cancellationUrl: oldCancellationUrl,
      }),
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });
    const oldProcessingToken = await claimEmailLogForImmediateDelivery(reminder.id);
    const barrier = createBarrier();
    const providerCalls: string[] = [];
    assert.ok(oldProcessingToken);
    const oldDelivery = deliverEmailLog(reminder.id, oldProcessingToken, {
      beforeDeliveryAuthorization: barrier.wait,
      sendEmail: async () => {
        providerCalls.push("old-worker");
        return { provider: "log", messageId: "must-not-send" };
      },
    });

    await barrier.entered;
    const resend = await createResendEmailLog({ emailLog: sourceForResend });
    const [reconciledReminder, currentBooking, revokedTokens, activeTokens] = await Promise.all([
      prisma.emailLog.findUniqueOrThrow({ where: { id: reminder.id } }),
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: { communicationGeneration: true, reminder24hSentAt: true },
      }),
      prisma.bookingActionToken.count({
        where: { id: { in: oldTokens.map((token) => token.id) }, revokedAt: { not: null } },
      }),
      prisma.bookingActionToken.count({
        where: { bookingId: fixture.bookingId, revokedAt: null },
      }),
    ]);
    const reconciledPayload = reconciledReminder.payload as Record<string, unknown>;

    assert.ok(resend);
    assert.equal(reconciledReminder.status, EmailLogStatus.PENDING);
    assert.equal(reconciledReminder.processingStartedAt, null);
    assert.equal(reconciledReminder.processingToken, null);
    assert.equal(reconciledReminder.communicationGeneration, 9);
    assert.notEqual(reconciledPayload.manageReservationUrl, oldManageUrl);
    assert.notEqual(reconciledPayload.cancellationUrl, oldCancellationUrl);
    assert.equal(currentBooking.communicationGeneration, 9);
    assert.equal(currentBooking.reminder24hSentAt, null);
    assert.equal(revokedTokens, oldTokens.length);
    assert.equal(activeTokens, 2);

    barrier.release();
    const oldResult = await oldDelivery;
    const afterOldWorker = await prisma.emailLog.findUniqueOrThrow({ where: { id: reminder.id } });
    assert.equal(oldResult.status, "skipped");
    assert.deepEqual(providerCalls, []);
    assert.equal(afterOldWorker.status, EmailLogStatus.PENDING);
    assert.equal(afterOldWorker.processingToken, null);

    const currentProcessingToken = await claimEmailLogForImmediateDelivery(reminder.id);
    assert.ok(currentProcessingToken);
    const currentResult = await deliverEmailLog(reminder.id, currentProcessingToken, {
      sendEmail: async () => ({ provider: "log", messageId: `new-reminder-${seed}` }),
    });
    const [sentReminder, sentBooking] = await Promise.all([
      prisma.emailLog.findUniqueOrThrow({ where: { id: reminder.id } }),
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: { reminder24hSentAt: true },
      }),
    ]);
    assert.equal(currentResult.status, "sent");
    assert.equal(sentReminder.status, EmailLogStatus.SENT);
    assert.ok(sentBooking.reminder24hSentAt);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("tokenizovaný resend u běžného CLIENT logu ruší claim a zachová nový delivery flow", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const { createResendEmailLog } = await import("@/features/admin/actions/email-log-resend");
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);

  try {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { clientId: true },
    });
    const source = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId,
        clientId: booking.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.FAILED,
        recipientEmail: fixture.email,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: buildBookingEmailPayload(fixture),
      },
    });
    const pendingConfirmation = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_CONFIRMED,
      templateKey: "booking-approved-v1",
      clientId: booking.clientId,
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });
    const oldProcessingToken = await claimEmailLogForImmediateDelivery(pendingConfirmation.id);
    assert.ok(oldProcessingToken);

    await createResendEmailLog({ emailLog: sourceForResend });
    const reconciled = await prisma.emailLog.findUniqueOrThrow({ where: { id: pendingConfirmation.id } });
    assert.equal(reconciled.status, EmailLogStatus.PENDING);
    assert.equal(reconciled.processingStartedAt, null);
    assert.equal(reconciled.processingToken, null);

    const replacementProcessingToken = await claimEmailLogForImmediateDelivery(pendingConfirmation.id);
    assert.ok(replacementProcessingToken);
    const result = await deliverEmailLog(pendingConfirmation.id, replacementProcessingToken, {
      sendEmail: async () => ({ provider: "log", messageId: `new-confirmation-${seed}` }),
    });
    assert.equal(result.status, "sent");
    assert.equal(
      (await prisma.emailLog.findUniqueOrThrow({ where: { id: pendingConfirmation.id } })).status,
      EmailLogStatus.SENT,
    );
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("tokenizovaný CLIENT resend při aktivním delivery lease nerotuje credentials", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma } = await loadModules();
  const { createResendEmailLog } = await import("@/features/admin/actions/email-log-resend");
  const { ActiveClientDeliveryLeaseError } = await import("@/lib/email/booking-delivery-fence");
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);

  try {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { clientId: true, communicationGeneration: true },
    });
    const oldToken = await prisma.bookingActionToken.create({
      data: { bookingId: fixture.bookingId, type: "RESCHEDULE", tokenHash: `leased-${seed}`, expiresAt: addMinutes(new Date(), 60) },
    });
    const source = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_CONFIRMED,
      templateKey: "booking-approved-v1",
      clientId: booking.clientId,
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        clientDeliveryLeaseToken: `worker-${seed}`,
        clientDeliveryLeaseExpiresAt: addMinutes(new Date(), 5),
      },
    });

    await assert.rejects(
      createResendEmailLog({ emailLog: sourceForResend }),
      ActiveClientDeliveryLeaseError,
    );
    const [storedBooking, storedToken, resendCount] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId }, select: { communicationGeneration: true } }),
      prisma.bookingActionToken.findUniqueOrThrow({ where: { id: oldToken.id }, select: { revokedAt: true } }),
      prisma.emailLog.count({ where: { resendOfId: source.id } }),
    ]);

    assert.equal(storedBooking.communicationGeneration, booking.communicationGeneration);
    assert.equal(storedToken.revokedAt, null);
    assert.equal(resendCount, 0);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("resend zastaralého potvrzení nerevokuje aktuální tokeny ani nezaloží nový log", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma } = await loadModules();
  const { createResendEmailLog } = await import("@/features/admin/actions/email-log-resend");
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);

  try {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { clientId: true },
    });
    const currentTokens = await Promise.all([
      prisma.bookingActionToken.create({
        data: { bookingId: fixture.bookingId, type: "RESCHEDULE", tokenHash: `current-manage-${seed}`, expiresAt: addMinutes(new Date(), 60) },
      }),
      prisma.bookingActionToken.create({
        data: { bookingId: fixture.bookingId, type: "CANCEL", tokenHash: `current-cancel-${seed}`, expiresAt: addMinutes(new Date(), 60) },
      }),
    ]);
    const source = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId,
        clientId: booking.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.FAILED,
        recipientEmail: fixture.email,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: {
          scheduledStartsAt: fixture.startsAt.toISOString(),
          scheduledEndsAt: fixture.endsAt.toISOString(),
          manageReservationUrl: "[REDACTED]",
          cancellationUrl: "[REDACTED]",
        },
      },
    });
    await prisma.booking.update({ where: { id: fixture.bookingId }, data: { status: BookingStatus.CANCELLED } });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: { client: { select: { id: true, email: true } }, booking: { select: { id: true, clientEmailSnapshot: true } } },
    });

    assert.equal(await createResendEmailLog({ emailLog: sourceForResend }), null);
    const [tokens, resendCount] = await Promise.all([
      prisma.bookingActionToken.findMany({ where: { id: { in: currentTokens.map((token) => token.id) } }, select: { revokedAt: true } }),
      prisma.emailLog.count({ where: { resendOfId: source.id } }),
    ]);
    assert.deepEqual(tokens.map((token) => token.revokedAt), [null, null]);
    assert.equal(resendCount, 0);

    await prisma.booking.update({ where: { id: fixture.bookingId }, data: { status: BookingStatus.CONFIRMED } });
    const staleReschedule = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId,
        clientId: booking.clientId,
        type: EmailLogType.BOOKING_RESCHEDULED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.SENT,
        recipientEmail: fixture.email,
        subject: "Rezervace přesunuta",
        templateKey: "booking-rescheduled-v1",
        payload: {
          scheduledStartsAt: fixture.startsAt.toISOString(),
          scheduledEndsAt: fixture.endsAt.toISOString(),
          manageReservationUrl: "[REDACTED]",
          cancellationUrl: "[REDACTED]",
        },
      },
    });
    const movedStartsAt = addMinutes(fixture.startsAt, 60);
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { scheduledStartsAt: movedStartsAt, scheduledEndsAt: addMinutes(movedStartsAt, 60) },
    });
    const staleRescheduleSource = await prisma.emailLog.findUniqueOrThrow({
      where: { id: staleReschedule.id },
      include: { client: { select: { id: true, email: true } }, booking: { select: { id: true, clientEmailSnapshot: true } } },
    });
    assert.equal(await createResendEmailLog({ emailLog: staleRescheduleSource }), null);
    assert.equal(await prisma.emailLog.count({ where: { resendOfId: staleReschedule.id } }), 0);
    assert.equal(await prisma.bookingActionToken.count({
      where: { id: { in: currentTokens.map((token) => token.id) }, revokedAt: null },
    }), 2);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("resend potvrzení se starou serviceId odmítne bez změny tokenů", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma } = await loadModules();
  const { createResendEmailLog } = await import("@/features/admin/actions/email-log-resend");
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const alternativeService = await createAlternativeService(fixture, seed);

  try {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { clientId: true },
    });
    const currentTokens = await Promise.all([
      prisma.bookingActionToken.create({
        data: {
          bookingId: fixture.bookingId,
          type: "RESCHEDULE",
          tokenHash: `service-resend-manage-${seed}`,
          expiresAt: addMinutes(new Date(), 60),
        },
      }),
      prisma.bookingActionToken.create({
        data: {
          bookingId: fixture.bookingId,
          type: "CANCEL",
          tokenHash: `service-resend-cancel-${seed}`,
          expiresAt: addMinutes(new Date(), 60),
        },
      }),
    ]);
    const source = await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId,
        clientId: booking.clientId,
        type: EmailLogType.BOOKING_CONFIRMED,
        audience: EmailAudience.CLIENT,
        status: EmailLogStatus.FAILED,
        recipientEmail: fixture.email,
        subject: "Rezervace potvrzena",
        templateKey: "booking-approved-v1",
        payload: {
          serviceId: fixture.serviceId,
          scheduledStartsAt: fixture.startsAt.toISOString(),
          scheduledEndsAt: fixture.endsAt.toISOString(),
          manageReservationUrl: "[REDACTED]",
          cancellationUrl: "[REDACTED]",
        },
      },
    });
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        serviceId: alternativeService.id,
        serviceNameSnapshot: alternativeService.name,
      },
    });
    const sourceForResend = await prisma.emailLog.findUniqueOrThrow({
      where: { id: source.id },
      include: {
        client: { select: { id: true, email: true } },
        booking: { select: { id: true, clientEmailSnapshot: true } },
      },
    });

    assert.equal(await createResendEmailLog({ emailLog: sourceForResend }), null);
    const [tokens, resendCount] = await Promise.all([
      prisma.bookingActionToken.findMany({
        where: { id: { in: currentTokens.map((token) => token.id) } },
        select: { revokedAt: true },
      }),
      prisma.emailLog.count({ where: { resendOfId: source.id } }),
    ]);
    assert.deepEqual(tokens.map((token) => token.revokedAt), [null, null]);
    assert.equal(resendCount, 0);
  } finally {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { serviceId: fixture.serviceId },
    });
    await prisma.service.delete({ where: { id: alternativeService.id } });
    await cleanupBookingFixture(fixture);
  }
});

dbTest("migrace historických FAILED logů rediguje známá bearer pole a zachová ostatní data", async () => {
  const seed = randomUUID();
  const { prisma } = await loadModules();
  const migrationSql = await readFile(
    "prisma/migrations/20260829120000_scrub_failed_email_log_bearer_payloads/migration.sql",
    "utf8",
  );
  const emailLog = await prisma.emailLog.create({
    data: {
      type: EmailLogType.GENERIC,
      status: EmailLogStatus.FAILED,
      recipientEmail: `migration-failed-${seed}@example.com`,
      subject: "Historický failure",
      templateKey: "migration-test",
      payload: {
        manageReservationUrl: `https://example.com/manage/raw-${seed}`,
        cancellationUrl: `https://example.com/cancel/raw-${seed}`,
        approveUrl: `https://example.com/approve/raw-${seed}`,
        rejectUrl: `https://example.com/reject/raw-${seed}`,
        customAuditValue: "zachovat",
      },
    },
  });

  try {
    await prisma.$executeRawUnsafe(migrationSql);
    const stored = await prisma.emailLog.findUniqueOrThrow({
      where: { id: emailLog.id },
      select: { status: true, payload: true },
    });
    const payload = stored.payload as Record<string, unknown>;

    assert.equal(stored.status, EmailLogStatus.FAILED);
    assert.equal(payload.manageReservationUrl, "[REDACTED]");
    assert.equal(payload.cancellationUrl, "[REDACTED]");
    assert.equal(payload.approveUrl, "[REDACTED]");
    assert.equal(payload.rejectUrl, "[REDACTED]");
    assert.equal(payload.customAuditValue, "zachovat");
  } finally {
    await prisma.emailLog.deleteMany({ where: { id: emailLog.id } });
  }
});

dbTest("migrace communicationGeneration selektivně zachová jen prokazatelně aktuální legacy log", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const migrationSql = await readFile(
    "prisma/migrations/20260830120000_client_email_delivery_fencing/migration.sql",
    "utf8",
  );
  const rollbackMarker = "migration-test-rollback";
  let observed: Array<{ communicationGeneration: number }> = [];

  try {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const payload = buildBookingEmailPayload(fixture);
        const ambiguousPayload = Object.fromEntries(
          Object.entries(payload).filter(([key]) => key !== "serviceId"),
        ) satisfies Prisma.InputJsonObject;
        const logs = await Promise.all([
          tx.emailLog.create({
            data: {
              bookingId: fixture.bookingId,
              type: EmailLogType.BOOKING_CONFIRMED,
              audience: EmailAudience.CLIENT,
              status: EmailLogStatus.PENDING,
              recipientEmail: fixture.email,
              subject: "Aktuální legacy confirmation",
              templateKey: "booking-approved-v1",
              payload,
            },
          }),
          tx.emailLog.create({
            data: {
              bookingId: fixture.bookingId,
              type: EmailLogType.BOOKING_CONFIRMED,
              audience: EmailAudience.CLIENT,
              status: EmailLogStatus.FAILED,
              recipientEmail: `stale-recipient-${seed}@example.com`,
              subject: "Stale recipient",
              templateKey: "booking-approved-v1",
              payload,
            },
          }),
          tx.emailLog.create({
            data: {
              bookingId: fixture.bookingId,
              type: EmailLogType.BOOKING_CONFIRMED,
              audience: EmailAudience.CLIENT,
              status: EmailLogStatus.FAILED,
              recipientEmail: fixture.email,
              subject: "Stale service",
              templateKey: "booking-approved-v1",
              payload: { ...payload, serviceId: "stale-service" },
            },
          }),
          tx.emailLog.create({
            data: {
              bookingId: fixture.bookingId,
              type: EmailLogType.BOOKING_CONFIRMED,
              audience: EmailAudience.CLIENT,
              status: EmailLogStatus.FAILED,
              recipientEmail: fixture.email,
              subject: "Stale term",
              templateKey: "booking-approved-v1",
              payload: {
                ...payload,
                scheduledStartsAt: addMinutes(fixture.startsAt, 15).toISOString(),
              },
            },
          }),
          tx.emailLog.create({
            data: {
              bookingId: fixture.bookingId,
              type: EmailLogType.BOOKING_RECEIVED,
              audience: EmailAudience.CLIENT,
              status: EmailLogStatus.FAILED,
              recipientEmail: fixture.email,
              subject: "Status mismatch",
              templateKey: "booking-confirmation-v1",
              payload,
            },
          }),
          tx.emailLog.create({
            data: {
              bookingId: fixture.bookingId,
              type: EmailLogType.BOOKING_CONFIRMED,
              audience: EmailAudience.CLIENT,
              status: EmailLogStatus.FAILED,
              recipientEmail: fixture.email,
              subject: "Ambiguous payload",
              templateKey: "booking-approved-v1",
              payload: ambiguousPayload,
            },
          }),
        ]);

        await tx.$executeRawUnsafe(migrationSql);
        observed = await Promise.all(
          logs.map((log) => tx.emailLog.findUniqueOrThrow({
            where: { id: log.id },
            select: { communicationGeneration: true },
          })),
        );

        throw new Error(rollbackMarker);
      }),
      { message: rollbackMarker },
    );

    assert.deepEqual(
      observed.map((log) => log.communicationGeneration),
      [1, 0, 0, 0, 0, 0],
    );
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("scheduler catch-up doplní reminder po úzkém okně, deduplikuje jej a ignoruje budoucí i začaté bookingy", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, runBookingReminderSchedulerOnce } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);

  try {
    await runBookingReminderSchedulerOnce(addMinutes(window.startsAt, -(30 * 60)));
    assert.equal(await prisma.emailLog.count({
      where: {
        bookingId: fixture.bookingId,
        type: EmailLogType.BOOKING_REMINDER,
      },
    }), 0);

    await runBookingReminderSchedulerOnce(addMinutes(window.startsAt, -(24 * 60)));

    const [booking, emailLog] = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: {
          reminder24hQueuedAt: true,
          reminder24hSentAt: true,
        },
      }),
      prisma.emailLog.findFirstOrThrow({
        where: {
          bookingId: fixture.bookingId,
          type: EmailLogType.BOOKING_REMINDER,
        },
        select: {
          status: true,
          payload: true,
        },
      }),
    ]);

    const payload = emailLog.payload as Record<string, unknown>;

    assert.equal(emailLog.status, EmailLogStatus.SENT);
    assert.ok(booking.reminder24hQueuedAt);
    assert.ok(booking.reminder24hSentAt);
    assert.equal(payload.serviceId, fixture.serviceId);
    assert.equal(payload.serviceName, `Worker service ${seed}`);
    assert.equal(payload.scheduledStartsAt, fixture.startsAt.toISOString());
    assert.equal(payload.scheduledEndsAt, fixture.endsAt.toISOString());
    assert.equal(payload.manageReservationUrl, "[REDACTED]");
    assert.equal(payload.cancellationUrl, "[REDACTED]");

    await runBookingReminderSchedulerOnce(addMinutes(window.startsAt, -(23 * 60)));
    assert.equal(await prisma.emailLog.count({
      where: {
        bookingId: fixture.bookingId,
        type: EmailLogType.BOOKING_REMINDER,
      },
    }), 1);

    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        reminder24hQueuedAt: null,
        reminder24hSentAt: null,
      },
    });
    await prisma.emailLog.deleteMany({
      where: {
        bookingId: fixture.bookingId,
        type: EmailLogType.BOOKING_REMINDER,
      },
    });
    await runBookingReminderSchedulerOnce(addMinutes(window.startsAt, 1));
    assert.equal(await prisma.emailLog.count({
      where: {
        bookingId: fixture.bookingId,
        type: EmailLogType.BOOKING_REMINDER,
      },
    }), 0);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("manual confirmed booking uvnitř catch-up window založí právě jeden reminder", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma } = await loadModules();
  const window = await findIsolatedReminderAuthorizationWindow(prisma, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt, {
    preserveAutoReminder: true,
  });

  try {
    assert.equal(await prisma.emailLog.count({
      where: {
        bookingId: fixture.bookingId,
        type: EmailLogType.BOOKING_REMINDER,
      },
    }), 1);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("runEmailDeliveryWorkerOnce delivers queued reminder email and marks booking reminder as sent", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, runEmailDeliveryWorkerOnce } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const reminderStartsAt = addMinutes(new Date(), 120);
  const reminderEndsAt = addMinutes(reminderStartsAt, 60);

  try {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { scheduledStartsAt: reminderStartsAt, scheduledEndsAt: reminderEndsAt },
    });
    await prisma.emailLog.create({
      data: {
        bookingId: fixture.bookingId,
        type: EmailLogType.BOOKING_REMINDER,
        status: EmailLogStatus.PENDING,
        recipientEmail: fixture.email,
        subject: "Zítra se na vás těšíme v PP Studiu",
        templateKey: "booking-reminder-24h-v1",
        payload: {
          bookingId: fixture.bookingId,
          serviceId: fixture.serviceId,
          serviceName: `Worker service ${seed}`,
          clientName: `Worker klientka ${seed}`,
          scheduledStartsAt: reminderStartsAt.toISOString(),
          scheduledEndsAt: reminderEndsAt.toISOString(),
          manageReservationUrl: "https://example.com/rezervace/sprava/test-token",
          cancellationUrl: "https://example.com/rezervace/storno/test-token",
          manualReminderResend: true,
        },
      },
    });

    const processed = await runEmailDeliveryWorkerOnce();

    assert.equal(processed, 1);

    const [booking, emailLog] = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: {
          reminder24hQueuedAt: true,
          reminder24hSentAt: true,
        },
      }),
      prisma.emailLog.findFirstOrThrow({
        where: {
          bookingId: fixture.bookingId,
          type: EmailLogType.BOOKING_REMINDER,
        },
        select: {
          status: true,
          provider: true,
          sentAt: true,
          errorMessage: true,
        },
      }),
    ]);

    assert.equal(emailLog.status, EmailLogStatus.SENT);
    assert.equal(emailLog.provider, "log");
    assert.ok(emailLog.sentAt);
    assert.equal(emailLog.errorMessage, null);
    assert.ok(booking.reminder24hQueuedAt);
    assert.ok(booking.reminder24hSentAt);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("před delivery přeskočí potvrzení po zrušení rezervace a log už nezopakuje", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_CONFIRMED,
    templateKey: "booking-approved-v1",
  });
  let sendCalls = 0;

  try {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { status: BookingStatus.CANCELLED },
    });
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => {
        sendCalls += 1;
        return { provider: "log", messageId: "not-sent" };
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.equal(result.status, "skipped");
    assert.equal(sendCalls, 0);
    assert.equal(stored.status, EmailLogStatus.SENT);
    assert.equal(stored.provider, "system-skip");
    assert.equal(stored.processingToken, null);
    assert.match(stored.errorMessage ?? "", /no longer confirmed/i);
    assert.equal(await claimEmailLogForImmediateDelivery(emailLog.id), null);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("potvrzení beze změny rezervace se doručí", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_CONFIRMED,
    templateKey: "booking-approved-v1",
  });
  const idempotencyKeys: string[] = [];

  try {
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async (input) => {
        assert.ok(input.idempotencyKey);
        idempotencyKeys.push(input.idempotencyKey);
        return { provider: "log", messageId: "confirmed-delivery" };
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.deepEqual(result, { status: "sent" });
    assert.equal(stored.status, EmailLogStatus.SENT);
    assert.equal(stored.provider, "log");
    assert.deepEqual(idempotencyKeys, [`email-log/${emailLog.id}`]);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("vypršení lease před finalizací vrátí i po provider acceptance log do PENDING", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_CONFIRMED,
    templateKey: "booking-approved-v1",
  });
  let providerCalls = 0;

  try {
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      beforeProviderSend: async () => {
        await prisma.booking.update({
          where: { id: fixture.bookingId },
          data: { clientDeliveryLeaseExpiresAt: new Date(0) },
        });
      },
      sendEmail: async () => {
        providerCalls += 1;
        return { provider: "log", messageId: "accepted-before-finalize" };
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.equal(result.status, "deferred");
    assert.equal(providerCalls, 1);
    assert.equal(stored.status, EmailLogStatus.PENDING);
    assert.equal(stored.processingStartedAt, null);
    assert.equal(stored.processingToken, null);
    assert.deepEqual(stored.payload, emailLog.payload);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("cizí aktivní delivery lease job odloží a po expiraci pokračuje stejným idempotency key", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const { CLIENT_DELIVERY_LEASE_BUSY_BUFFER_MS } = await import("@/lib/email/booking-delivery-fence");
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_CONFIRMED,
    templateKey: "booking-approved-v1",
  });
  const originalPayload = emailLog.payload;
  const leaseExpiresAt = new Date(Date.now() + 60 * 1000);
  const sentIdempotencyKeys: string[] = [];

  try {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        clientDeliveryLeaseToken: "previous-worker-token",
        clientDeliveryLeaseExpiresAt: leaseExpiresAt,
      },
    });

    const firstToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(firstToken);
    const firstResult = await deliverEmailLog(emailLog.id, firstToken, {
      sendEmail: async () => {
        throw new Error("Provider nesmí být při LEASE_BUSY zavolán.");
      },
    });
    const deferred = await prisma.emailLog.findUniqueOrThrow({
      where: { id: emailLog.id },
      select: {
        status: true,
        processingStartedAt: true,
        processingToken: true,
        nextAttemptAt: true,
        payload: true,
      },
    });

    assert.equal(firstResult.status, "deferred");
    assert.equal(deferred.status, EmailLogStatus.PENDING);
    assert.equal(deferred.processingStartedAt, null);
    assert.equal(deferred.processingToken, null);
    assert.ok(
      deferred.nextAttemptAt.getTime()
        >= leaseExpiresAt.getTime() + CLIENT_DELIVERY_LEASE_BUSY_BUFFER_MS,
    );
    assert.deepEqual(deferred.payload, originalPayload);

    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        clientDeliveryLeaseToken: "previous-worker-token",
        clientDeliveryLeaseExpiresAt: new Date(0),
      },
    });

    const retryToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(retryToken);
    const retryResult = await deliverEmailLog(emailLog.id, retryToken, {
      sendEmail: async (input) => {
        sentIdempotencyKeys.push(input.idempotencyKey ?? "");
        return { provider: "log", messageId: "after-lease-expiry" };
      },
    });

    assert.deepEqual(retryResult, { status: "sent" });
    assert.deepEqual(sentIdempotencyKeys, [`email-log/${emailLog.id}`]);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("claim takeover po provider ACK nesmí starým workerem zapsat reminder marker ani SENT", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const { EMAIL_WORKER_LOCK_TIMEOUT_MS } = await import("@/lib/email/booking-delivery-fence");
  const window = await findIsolatedReminderAuthorizationWindow(prisma, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_REMINDER,
    templateKey: "booking-reminder-24h-v1",
    payload: buildBookingEmailPayload(fixture),
  });
  const barrier = createBarrier();
  const idempotencyKeys: string[] = [];

  try {
    const tokenA = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(tokenA);
    const firstDelivery = deliverEmailLog(emailLog.id, tokenA, {
      sendEmail: async (input) => {
        idempotencyKeys.push(input.idempotencyKey ?? "");
        return { provider: "resend", messageId: "provider-accepted-before-takeover" };
      },
      beforeDeliveryFinalization: barrier.wait,
    });

    await barrier.entered;
    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: {
        processingStartedAt: new Date(Date.now() - EMAIL_WORKER_LOCK_TIMEOUT_MS - 1),
      },
    });
    const tokenB = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(tokenB);
    assert.notEqual(tokenB, tokenA);
    const takeoverResult = await deliverEmailLog(emailLog.id, tokenB, {
      sendEmail: async () => {
        throw new Error("Provider nesmí být při cizím aktivním lease zavolán.");
      },
    });
    assert.equal(takeoverResult.status, "deferred");

    barrier.release();
    const firstResult = await firstDelivery;
    assert.equal(firstResult.status, "skipped");

    const afterLostClaim = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: { reminder24hSentAt: true },
      }),
      prisma.emailLog.findUniqueOrThrow({
        where: { id: emailLog.id },
        select: { status: true, processingToken: true, providerMessageId: true, provider: true },
      }),
    ]);
    assert.equal(afterLostClaim[0].reminder24hSentAt, null);
    assert.equal(afterLostClaim[1].status, EmailLogStatus.PENDING);
    assert.equal(afterLostClaim[1].processingToken, null);
    assert.equal(afterLostClaim[1].providerMessageId, null);
    assert.notEqual(afterLostClaim[1].provider, "system-skip");

    const recoveryToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(recoveryToken);
    const recoveryResult = await deliverEmailLog(emailLog.id, recoveryToken, {
      sendEmail: async (input) => {
        idempotencyKeys.push(input.idempotencyKey ?? "");
        return { provider: "resend", messageId: "provider-accepted-before-takeover" };
      },
    });
    assert.deepEqual(recoveryResult, { status: "sent" });
    assert.deepEqual(idempotencyKeys, [
      `email-log/${emailLog.id}`,
      `email-log/${emailLog.id}`,
    ]);

    const recovered = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: { reminder24hSentAt: true },
      }),
      prisma.emailLog.findUniqueOrThrow({
        where: { id: emailLog.id },
        select: { status: true, providerMessageId: true },
      }),
    ]);
    assert.ok(recovered[0].reminder24hSentAt);
    assert.equal(recovered[1].status, EmailLogStatus.SENT);
    assert.equal(recovered[1].providerMessageId, "provider-accepted-before-takeover");
  } finally {
    barrier.release();
    await cleanupBookingFixture(fixture);
  }
});

dbTest("změna služby při stejném termínu přeskočí staré potvrzení a nové se doručí", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const alternativeService = await createAlternativeService(fixture, seed);

  try {
    const staleEmailLog = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_CONFIRMED,
      templateKey: "booking-approved-v1",
    });
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        serviceId: alternativeService.id,
        serviceNameSnapshot: alternativeService.name,
      },
    });

    const staleClaim = await claimEmailLogForImmediateDelivery(staleEmailLog.id);
    assert.ok(staleClaim);
    const staleResult = await deliverEmailLog(staleEmailLog.id, staleClaim, {
      sendEmail: async () => ({ provider: "log", messageId: "must-not-send" }),
    });
    const staleStored = await prisma.emailLog.findUniqueOrThrow({ where: { id: staleEmailLog.id } });

    assert.equal(staleResult.status, "skipped");
    assert.equal(staleStored.provider, "system-skip");
    assert.match(staleStored.errorMessage ?? "", /service no longer matches/i);

    const currentEmailLog = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_CONFIRMED,
      templateKey: "booking-approved-v1",
      payload: buildBookingEmailPayload(fixture, {
        serviceId: alternativeService.id,
        serviceName: alternativeService.name,
      }),
    });
    const currentClaim = await claimEmailLogForImmediateDelivery(currentEmailLog.id);
    assert.ok(currentClaim);

    assert.deepEqual(await deliverEmailLog(currentEmailLog.id, currentClaim, {
      sendEmail: async () => ({ provider: "log", messageId: "current-service-delivery" }),
    }), { status: "sent" });
  } finally {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { serviceId: fixture.serviceId },
    });
    await prisma.service.delete({ where: { id: alternativeService.id } });
    await cleanupBookingFixture(fixture);
  }
});

dbTest("klientský přesun se starou serviceId se systémově přeskočí", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const alternativeService = await createAlternativeService(fixture, seed);

  try {
    const emailLog = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_RESCHEDULED,
      templateKey: "booking-rescheduled-v1",
    });
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        serviceId: alternativeService.id,
        serviceNameSnapshot: alternativeService.name,
      },
    });
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "log", messageId: "must-not-send" }),
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.equal(result.status, "skipped");
    assert.equal(stored.provider, "system-skip");
    assert.match(stored.errorMessage ?? "", /service no longer matches/i);
  } finally {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { serviceId: fixture.serviceId },
    });
    await prisma.service.delete({ where: { id: alternativeService.id } });
    await cleanupBookingFixture(fixture);
  }
});

dbTest("reminder se starou serviceId se systémově přeskočí", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const alternativeService = await createAlternativeService(fixture, seed);

  try {
    const emailLog = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_REMINDER,
      templateKey: "booking-reminder-24h-v1",
    });
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        serviceId: alternativeService.id,
        serviceNameSnapshot: alternativeService.name,
      },
    });
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "log", messageId: "must-not-send" }),
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.equal(result.status, "skipped");
    assert.equal(stored.provider, "system-skip");
    assert.match(stored.errorMessage ?? "", /service no longer matches/i);
  } finally {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { serviceId: fixture.serviceId },
    });
    await prisma.service.delete({ where: { id: alternativeService.id } });
    await cleanupBookingFixture(fixture);
  }
});

dbTest("legacy booking email bez serviceId zůstává doručitelný", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);

  try {
    const legacyPayload = { ...buildBookingEmailPayload(fixture) };
    Reflect.deleteProperty(legacyPayload, "serviceId");
    const emailLog = await createPendingBookingEmailLog(fixture, {
      type: EmailLogType.BOOKING_CONFIRMED,
      templateKey: "booking-approved-v1",
      payload: legacyPayload,
    });
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    assert.deepEqual(await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "log", messageId: "legacy-delivery" }),
    }), { status: "sent" });
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("starý klientský přesun na A se přeskočí po dalším přesunu na B", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_RESCHEDULED,
    templateKey: "booking-rescheduled-v1",
  });

  try {
    const nextStartsAt = addMinutes(fixture.startsAt, 120);
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        scheduledStartsAt: nextStartsAt,
        scheduledEndsAt: addMinutes(nextStartsAt, 60),
      },
    });
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "log", messageId: "stale-reschedule" }),
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.equal(result.status, "skipped");
    assert.equal(stored.provider, "system-skip");
    assert.match(stored.errorMessage ?? "", /term no longer matches/i);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("nejnovější klientský přesun na B se doručí", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const nextStartsAt = addMinutes(fixture.startsAt, 120);
  const nextEndsAt = addMinutes(nextStartsAt, 60);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_RESCHEDULED,
    templateKey: "booking-rescheduled-v1",
    payload: buildBookingEmailPayload(fixture, {
      scheduledStartsAt: nextStartsAt.toISOString(),
      scheduledEndsAt: nextEndsAt.toISOString(),
    }),
  });

  try {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        scheduledStartsAt: nextStartsAt,
        scheduledEndsAt: nextEndsAt,
      },
    });
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "log", messageId: "latest-reschedule" }),
    });

    assert.deepEqual(result, { status: "sent" });
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("storno po CANCELLED se doručí", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_CANCELLED,
    templateKey: "booking-cancelled-v1",
  });

  try {
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { status: BookingStatus.CANCELLED },
    });
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "log", messageId: "cancellation-delivery" }),
    });

    assert.deepEqual(result, { status: "sent" });
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("provider failure ponechá platný booking e-mail pro retry", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_CONFIRMED,
    templateKey: "booking-approved-v1",
  });
  let sendCalls = 0;

  try {
    const firstToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(firstToken);
    const firstResult = await deliverEmailLog(emailLog.id, firstToken, {
      sendEmail: async () => {
        sendCalls += 1;
        throw new Error("simulated provider failure");
      },
    });
    assert.equal(firstResult.status, "failed");

    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const secondToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(secondToken);
    const secondResult = await deliverEmailLog(emailLog.id, secondToken, {
      sendEmail: async () => {
        sendCalls += 1;
        return { provider: "log", messageId: "retry-delivery" };
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } });

    assert.deepEqual(secondResult, { status: "sent" });
    assert.equal(sendCalls, 2);
    assert.equal(stored.status, EmailLogStatus.SENT);
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

dbTest("admin přesun zůstane historicky doručitelný po dalším přesunu", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_RESCHEDULED,
    audience: EmailAudience.ADMIN,
    templateKey: "admin-booking-rescheduled-v1",
  });

  try {
    const nextStartsAt = addMinutes(fixture.startsAt, 120);
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: {
        scheduledStartsAt: nextStartsAt,
        scheduledEndsAt: addMinutes(nextStartsAt, 60),
      },
    });
    const processingToken = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(processingToken);

    const result = await deliverEmailLog(emailLog.id, processingToken, {
      sendEmail: async () => ({ provider: "log", messageId: "admin-history" }),
    });

    assert.deepEqual(result, { status: "sent" });
  } finally {
    await cleanupBookingFixture(fixture);
  }
});

async function assertContactRotationFencesClaimedDelivery(
  barrierPhase: "beforeBookingPreflight" | "beforeDeliveryAuthorization",
) {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const { rotateClientBookingTokensForEmailChange } = await import(
    "@/features/admin/lib/client-contact-token-rotation"
  );
  const window = await findIsolatedWorkerWindow(prisma, seed, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: fixture.bookingId },
    select: { clientId: true },
  });
  const oldEmailLog = await createPendingBookingEmailLog(fixture, {
    clientId: booking.clientId,
    type: EmailLogType.BOOKING_CONFIRMED,
    templateKey: "booking-approved-v1",
  });
  const oldTokens = await prisma.bookingActionToken.findMany({
    where: { bookingId: fixture.bookingId, revokedAt: null },
    select: { id: true },
  });
  const processingToken = await claimEmailLogForImmediateDelivery(oldEmailLog.id);
  const barrier = createBarrier();
  const sentRecipients: string[] = [];
  assert.ok(processingToken);
  const deliveryPromise = deliverEmailLog(oldEmailLog.id, processingToken!, {
    [barrierPhase]: barrier.wait,
    sendEmail: async (input) => {
      sentRecipients.push(input.to);
      return { provider: "log", messageId: "must-not-send" };
    },
  });
  const newEmail = `rotated-${seed}@example.com`;

  try {
    await barrier.entered;
    await prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: booking.clientId },
        data: { email: newEmail },
      });
      await rotateClientBookingTokensForEmailChange(tx, {
        clientId: booking.clientId,
        bookingIds: [fixture.bookingId],
        newEmail,
        now: new Date(),
      });
    });
  } finally {
    barrier.release();
  }

  try {
    const result = await deliveryPromise;
    const [storedOldLog, currentBooking, replacement, revokedTokens] = await Promise.all([
      prisma.emailLog.findUniqueOrThrow({
        where: { id: oldEmailLog.id },
        select: { status: true, provider: true, errorMessage: true },
      }),
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: {
          clientEmailSnapshot: true,
          communicationGeneration: true,
          reminder24hSentAt: true,
        },
      }),
      prisma.emailLog.findFirst({
        where: {
          bookingId: fixture.bookingId,
          id: { not: oldEmailLog.id },
          type: EmailLogType.BOOKING_CONFIRMED,
          audience: EmailAudience.CLIENT,
          recipientEmail: newEmail,
        },
        orderBy: { createdAt: "desc" },
        select: { communicationGeneration: true, status: true },
      }),
      prisma.bookingActionToken.count({
        where: { id: { in: oldTokens.map((token) => token.id) }, revokedAt: { not: null } },
      }),
    ]);

    assert.equal(result.status, "skipped");
    assert.deepEqual(sentRecipients, []);
    assert.equal(storedOldLog.status, EmailLogStatus.SENT);
    assert.equal(storedOldLog.provider, "system-skip");
    assert.match(storedOldLog.errorMessage ?? "", /generation|recipient/i);
    assert.equal(currentBooking.clientEmailSnapshot, newEmail);
    assert.equal(currentBooking.communicationGeneration, 2);
    assert.equal(currentBooking.reminder24hSentAt, null);
    assert.ok(replacement);
    assert.equal(replacement.communicationGeneration, 2);
    assert.equal(revokedTokens, oldTokens.length);
  } finally {
    await prisma.client.update({
      where: { id: booking.clientId },
      data: { email: fixture.email },
    });
    await cleanupBookingFixture(fixture);
  }
}

dbTest("contact-change po claimu zneplatní starý CLIENT job bez odeslání", async () => {
  await assertContactRotationFencesClaimedDelivery("beforeBookingPreflight");
});

dbTest("contact-change po původním preflightu zneplatní starý CLIENT job bez odeslání", async () => {
  await assertContactRotationFencesClaimedDelivery("beforeDeliveryAuthorization");
});

dbTest("service-change mezi preflightem a autorizací zneplatní starý reminder", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const { updateAdminBookingService } = await import("@/features/admin/lib/admin-booking");
  const window = await findIsolatedReminderAuthorizationWindow(prisma, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const localDate = getPragueLocalDate(window.startsAt);
  const existingAutoLunchOverride = await prisma.autoLunchDayOverride.findUnique({
    where: { dateKey: localDate },
    select: { dateKey: true },
  });
  const createdAutoLunchOverride = !existingAutoLunchOverride;
  if (createdAutoLunchOverride) {
    await prisma.autoLunchDayOverride.create({ data: { dateKey: localDate } });
  }
  const alternativeService = await createAlternativeService(fixture, seed);
  const oldReminder = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_REMINDER,
    templateKey: "booking-reminder-24h-v1",
    payload: buildBookingEmailPayload(fixture),
  });
  const bookingBefore = await prisma.booking.findUniqueOrThrow({
    where: { id: fixture.bookingId },
    select: { updatedAt: true },
  });
  const processingToken = await claimEmailLogForImmediateDelivery(oldReminder.id);
  const barrier = createBarrier();
  const sentRecipients: string[] = [];
  assert.ok(processingToken);
  const deliveryPromise = deliverEmailLog(oldReminder.id, processingToken!, {
    beforeDeliveryAuthorization: barrier.wait,
    sendEmail: async (input) => {
      sentRecipients.push(input.to);
      return { provider: "log", messageId: "must-not-send" };
    },
  });

  let reminderStateAfterMutation: Date | null = null;
  try {
    await barrier.entered;
    const mutation = await updateAdminBookingService({
      bookingId: fixture.bookingId,
      serviceId: alternativeService.id,
      actorUserId: null,
      expectedUpdatedAt: bookingBefore.updatedAt.toISOString(),
      now: new Date(),
    });
    assert.equal(mutation.status, "success");
    reminderStateAfterMutation = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { reminder24hSentAt: true },
    }).then((booking) => booking.reminder24hSentAt);
  } finally {
    barrier.release();
  }

  try {
    const result = await deliveryPromise;
    const [storedOldReminder, currentBooking, replacement] = await Promise.all([
      prisma.emailLog.findUniqueOrThrow({
        where: { id: oldReminder.id },
        select: { status: true, provider: true },
      }),
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: { serviceId: true, communicationGeneration: true, reminder24hSentAt: true },
      }),
      prisma.emailLog.findFirst({
        where: {
          bookingId: fixture.bookingId,
          id: { not: oldReminder.id },
          type: EmailLogType.BOOKING_REMINDER,
          communicationGeneration: 2,
        },
        select: { payload: true },
      }),
    ]);

    assert.equal(result.status, "skipped");
    assert.deepEqual(sentRecipients, []);
    assert.equal(storedOldReminder.status, EmailLogStatus.SENT);
    assert.equal(storedOldReminder.provider, "system-skip");
    assert.equal(currentBooking.serviceId, alternativeService.id);
    assert.equal(currentBooking.communicationGeneration, 2);
    assert.equal(currentBooking.reminder24hSentAt?.getTime() ?? null, reminderStateAfterMutation?.getTime() ?? null);
    assert.ok(replacement);
    assert.equal((replacement.payload as Record<string, unknown>).serviceId, alternativeService.id);
  } finally {
    if (createdAutoLunchOverride) {
      await prisma.autoLunchDayOverride.delete({ where: { dateKey: localDate } });
    }
    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { serviceId: fixture.serviceId },
    });
    await prisma.service.delete({ where: { id: alternativeService.id } });
    await cleanupBookingFixture(fixture);
  }
});

dbTest("reschedule mezi preflightem a autorizací zneplatní starý reminder", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const { rescheduleBooking } = await import("@/features/booking/lib/booking-rescheduling");
  const window = await findIsolatedReminderAuthorizationWindow(prisma, 120);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const nextStartsAt = addMinutes(window.startsAt, 60);
  const nextEndsAt = addMinutes(nextStartsAt, 60);
  const nextSlot = await prisma.availabilitySlot.create({
    data: {
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
      status: "PUBLISHED",
      capacity: 1,
      serviceRestrictionMode: "ANY",
    },
    select: { id: true },
  });
  const oldReminder = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_REMINDER,
    templateKey: "booking-reminder-24h-v1",
    payload: buildBookingEmailPayload(fixture),
  });
  const bookingBefore = await prisma.booking.findUniqueOrThrow({
    where: { id: fixture.bookingId },
    select: { updatedAt: true },
  });
  const processingToken = await claimEmailLogForImmediateDelivery(oldReminder.id);
  const barrier = createBarrier();
  const sentRecipients: string[] = [];
  assert.ok(processingToken);
  const deliveryPromise = deliverEmailLog(oldReminder.id, processingToken!, {
    beforeDeliveryAuthorization: barrier.wait,
    sendEmail: async (input) => {
      sentRecipients.push(input.to);
      return { provider: "log", messageId: "must-not-send" };
    },
  });

  let reminderStateAfterMutation: Date | null = null;
  try {
    await barrier.entered;
    await rescheduleBooking({
      bookingId: fixture.bookingId,
      slotId: nextSlot.id,
      newStartAt: nextStartsAt.toISOString(),
      changedByUserId: null,
      changedByClient: false,
      allowManualOverride: true,
      notifyClient: false,
      expectedUpdatedAt: bookingBefore.updatedAt.toISOString(),
    });
    reminderStateAfterMutation = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.bookingId },
      select: { reminder24hSentAt: true },
    }).then((booking) => booking.reminder24hSentAt);
  } finally {
    barrier.release();
  }

  try {
    const result = await deliveryPromise;
    const [storedOldReminder, currentBooking, replacement] = await Promise.all([
      prisma.emailLog.findUniqueOrThrow({
        where: { id: oldReminder.id },
        select: { status: true, provider: true },
      }),
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.bookingId },
        select: {
          scheduledStartsAt: true,
          communicationGeneration: true,
          reminder24hSentAt: true,
        },
      }),
      prisma.emailLog.findFirst({
        where: {
          bookingId: fixture.bookingId,
          id: { not: oldReminder.id },
          type: EmailLogType.BOOKING_REMINDER,
          communicationGeneration: 2,
        },
        select: { payload: true },
      }),
    ]);

    assert.equal(result.status, "skipped");
    assert.deepEqual(sentRecipients, []);
    assert.equal(storedOldReminder.status, EmailLogStatus.SENT);
    assert.equal(storedOldReminder.provider, "system-skip");
    assert.equal(currentBooking.scheduledStartsAt.toISOString(), nextStartsAt.toISOString());
    assert.equal(currentBooking.communicationGeneration, 2);
    assert.equal(currentBooking.reminder24hSentAt?.getTime() ?? null, reminderStateAfterMutation?.getTime() ?? null);
    assert.ok(replacement);
    assert.equal(
      (replacement.payload as Record<string, unknown>).scheduledStartsAt,
      nextStartsAt.toISOString(),
    );
  } finally {
    await prisma.availabilitySlot.delete({ where: { id: nextSlot.id } }).catch(() => undefined);
    await cleanupBookingFixture(fixture);
  }
});

dbTest("stale reminder po retryable failure se při dalším claimu už neodešle", async () => {
  const seed = randomUUID().slice(0, 8);
  const { prisma, claimEmailLogForImmediateDelivery, deliverEmailLog } = await loadModules();
  const window = await findIsolatedReminderAuthorizationWindow(prisma, 60);
  const fixture = await createConfirmedManualBooking(seed, window.startsAt);
  const emailLog = await createPendingBookingEmailLog(fixture, {
    type: EmailLogType.BOOKING_REMINDER,
    templateKey: "booking-reminder-24h-v1",
    payload: buildBookingEmailPayload(fixture),
  });
  let sendCalls = 0;

  try {
    const firstClaim = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(firstClaim);
    assert.equal((await deliverEmailLog(emailLog.id, firstClaim, {
      sendEmail: async () => {
        sendCalls += 1;
        throw new Error("temporary provider failure");
      },
    })).status, "failed");

    await prisma.booking.update({
      where: { id: fixture.bookingId },
      data: { communicationGeneration: { increment: 1 } },
    });
    await prisma.emailLog.update({ where: { id: emailLog.id }, data: { nextAttemptAt: new Date(0) } });
    const retryClaim = await claimEmailLogForImmediateDelivery(emailLog.id);
    assert.ok(retryClaim);
    const retryResult = await deliverEmailLog(emailLog.id, retryClaim, {
      sendEmail: async () => {
        sendCalls += 1;
        return { provider: "log", messageId: "must-not-send" };
      },
    });
    const stored = await prisma.emailLog.findUniqueOrThrow({
      where: { id: emailLog.id },
      select: { status: true, provider: true },
    });

    assert.equal(retryResult.status, "skipped");
    assert.equal(sendCalls, 1);
    assert.equal(stored.status, EmailLogStatus.SENT);
    assert.equal(stored.provider, "system-skip");
  } finally {
    await cleanupBookingFixture(fixture);
  }
});
