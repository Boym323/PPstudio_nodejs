import "dotenv/config";

import { randomBytes } from "crypto";

import {
  AdminRole,
  AvailabilitySlotServiceRestrictionMode,
  AvailabilitySlotStatus,
  BookingActionTokenType,
  BookingActorType,
  BookingSource,
  BookingStatus,
  VoucherStatus,
  VoucherType,
} from "@/generated/prisma/client";

import {
  buildBookingActionToken,
  buildBookingSelfServiceActionExpiry,
} from "../../../src/features/booking/lib/booking-action-tokens";
import {
  formatDateKey,
  resolveWeekStart,
} from "../../../src/features/admin/lib/admin-slots/time";
import { hashPassword } from "../../../src/lib/auth/password";
import { prisma } from "../../../src/lib/prisma";

export type E2eFixture = {
  runId: string;
  serviceName: string;
  serviceSlug: string;
  categoryName: string;
  clientName: string;
  clientEmail: string;
  clientId?: string;
  voucherCode?: string;
  bookingId?: string;
  cancelToken?: string;
  manageToken?: string;
  adminEmail?: string;
  adminPassword?: string;
  slotLabels: {
    primaryDateKey: string;
    primaryTime: string;
    rescheduleDateKey: string;
    rescheduleTime: string;
    rescheduleConflictButtonLabel: string;
    rescheduleConflictSlotId: string;
    rescheduleSuccessButtonLabel: string;
    rescheduleSuccessSlotId: string;
    rescheduleSuccessStartAt: string;
    primaryStartAt: string;
    rescheduleStartAt: string;
  };
};

export type FragmentedCancellationFixture = E2eFixture & {
  adminEmail: string;
  adminPassword: string;
  planner: {
    weekKey: string;
    dayKey: string;
    beforeCancellationWindows: string[];
    afterCancellationWindow: string;
  };
};

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function addDays(value: Date, days: number) {
  const copy = new Date(value);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function futureUtcDate(daysFromNow: number, utcHour: number, utcMinute = 0) {
  const value = addDays(new Date(), daysFromNow);
  value.setUTCHours(utcHour, utcMinute, 0, 0);
  return value;
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

async function ensureE2eSiteSettings() {
  await prisma.siteSettings.upsert({
    where: { id: "site-settings" },
    update: {},
    create: {
      id: "site-settings",
      salonName: "PP Studio",
      addressLine: "Sadová 2",
      city: "Zlín",
      postalCode: "760 01",
      phone: "+420 732 856 036",
      contactEmail: "info@ppstudio.cz",
      bookingMinAdvanceHours: 2,
      bookingMaxAdvanceDays: 90,
      bookingCancellationHours: 48,
      notificationAdminEmail: process.env.ADMIN_OWNER_EMAIL ?? "owner@example.test",
      emailSenderName: "PP Studio",
      emailSenderEmail: "info@ppstudio.cz",
    },
  });
}

function formatPragueTime(value: Date) {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  }).format(value);
}

function formatPragueDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Prague",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not format Prague date key for ${value.toISOString()}`);
  }

  return `${year}-${month}-${day}`;
}

function formatPragueLongDateLabel(value: Date) {
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Prague",
  }).format(value);
}

function formatPragueTimeRange(startsAt: Date, endsAt: Date) {
  return `${formatPragueTime(startsAt)} - ${formatPragueTime(endsAt)}`;
}

function buildRunId() {
  return `e2e-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function hashRunId(runId: string) {
  let hash = 0;

  for (const character of runId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

async function resetE2eRecentAuditRateLimitState() {
  await prisma.bookingSubmissionLog.deleteMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 10 * 60 * 1000),
      },
    },
  });
  await prisma.rateLimitReservation.deleteMany({});
}

function roundUpToHalfHour(value: Date) {
  const copy = new Date(value);
  copy.setUTCSeconds(0, 0);
  const minutes = copy.getUTCMinutes();

  if (minutes === 0 || minutes === 30) {
    return copy;
  }

  if (minutes < 30) {
    copy.setUTCMinutes(30, 0, 0);
    return copy;
  }

  copy.setUTCHours(copy.getUTCHours() + 1, 0, 0, 0);
  return copy;
}

function buildPolicySafeStart(minLeadHours: number) {
  const minStart = addMinutes(new Date(), minLeadHours * 60);
  let daysFromNow = Math.max(1, Math.ceil(minLeadHours / 24));
  let candidate = futureUtcDate(daysFromNow, 8);

  while (candidate < minStart) {
    daysFromNow += 1;
    candidate = futureUtcDate(daysFromNow, 8);
  }

  return candidate;
}

function isAvailabilitySlotWindowConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return message.includes("AvailabilitySlot_active_time_window_excl");
}

async function createCatalogFixture(runId: string) {
  await ensureE2eSiteSettings();

  const fixtureLabel = hashRunId(runId).toString(16);
  const categoryName = `E2E kategorie ${fixtureLabel}`;
  const serviceName = `E2E služba ${fixtureLabel}`;
  const categorySlug = slugify(categoryName);
  const serviceSlug = slugify(serviceName);

  const category = await prisma.serviceCategory.create({
    data: {
      name: categoryName,
      slug: categorySlug,
      publicName: categoryName,
      description: "Dočasná E2E kategorie.",
      sortOrder: -10_000,
      pricingSortOrder: -10_000,
      isActive: true,
    },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: serviceName,
      publicName: serviceName,
      slug: serviceSlug,
      shortDescription: "Dočasná E2E služba pro ověření rezervačního flow.",
      publicIntro: "Dočasná E2E služba viditelná ve veřejném katalogu.",
      description: "Dočasný E2E popis služby pro ověření veřejného detailu.",
      seoDescription: "Dočasná E2E služba pro smoke test veřejného detailu.",
      durationMinutes: 60,
      priceFromCzk: 900,
      sortOrder: -10_000,
      isActive: true,
      isPubliclyBookable: true,
    },
  });

  const siteSettings = await prisma.siteSettings.findUnique({
    where: { id: "site-settings" },
    select: {
      bookingMinAdvanceHours: true,
      bookingMaxAdvanceDays: true,
      bookingCancellationHours: true,
    },
  });
  const minAdvanceHours = siteSettings?.bookingMinAdvanceHours ?? 2;
  const maxAdvanceDays = siteSettings?.bookingMaxAdvanceDays ?? 90;
  const cancellationHours = siteSettings?.bookingCancellationHours ?? 48;
  const baseLeadHours = Math.max(minAdvanceHours + 3, cancellationHours + 3);
  const maxWindowEnd = addMinutes(new Date(), maxAdvanceDays * 24 * 60);
  const maxSafeStart = addMinutes(maxWindowEnd, -(26 * 60 + service.durationMinutes));
  const baseStart = buildPolicySafeStart(baseLeadHours);
  const firstCandidate = baseStart <= maxSafeStart
    ? baseStart
    : roundUpToHalfHour(maxSafeStart);
  const existingActiveBookings = await prisma.booking.findMany({
    where: {
      status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      scheduledStartsAt: { lt: addMinutes(maxSafeStart, 180) },
      OR: [
        { blockedUntil: { gt: firstCandidate } },
        { blockedUntil: null, scheduledEndsAt: { gt: firstCandidate } },
      ],
    },
    select: {
      scheduledStartsAt: true,
      scheduledEndsAt: true,
      blockedUntil: true,
    },
  });
  const runOffset = hashRunId(runId) % 6;
  const rescheduleConflictPublicNote = `E2E reschedule conflict ${runId}`;
  const rescheduleSuccessPublicNote = `E2E reschedule success ${runId}`;
  let primarySlot;
  let rescheduleSlot;
  let rescheduleSuccessSlot;
  let primaryStart = firstCandidate;
  let primaryEnd = addMinutes(primaryStart, 180);
  let rescheduleStart = addMinutes(primaryStart, 24 * 60);
  let rescheduleSuccessStart = addMinutes(rescheduleStart, service.durationMinutes);
  let rescheduleEnd = addMinutes(rescheduleSuccessStart, service.durationMinutes);

  for (let attempt = 0; attempt < 96; attempt += 1) {
    const candidateIndex = runOffset + attempt;
    const candidateOffset = Math.floor(candidateIndex / 6) * 24 * 60
      + (candidateIndex % 6) * 2 * 60;
    primaryStart = addMinutes(firstCandidate, candidateOffset);

    if (primaryStart > maxSafeStart) {
      primaryStart = addMinutes(firstCandidate, (candidateIndex % 6) * 2 * 60);
    }

    primaryEnd = addMinutes(primaryStart, 180);
    rescheduleStart = addMinutes(primaryStart, 24 * 60);
    rescheduleSuccessStart = addMinutes(rescheduleStart, service.durationMinutes);
    rescheduleEnd = addMinutes(rescheduleSuccessStart, service.durationMinutes);

    const hasExistingBookingConflict = existingActiveBookings.some((booking) => {
      const blockedUntil = booking.blockedUntil ?? booking.scheduledEndsAt;

      return [
        [primaryStart, primaryEnd],
        [rescheduleStart, rescheduleEnd],
      ].some(([windowStart, windowEnd]) => (
        booking.scheduledStartsAt < windowEnd && blockedUntil > windowStart
      ));
    });

    if (hasExistingBookingConflict) {
      continue;
    }

    try {
      [primarySlot, rescheduleSlot, rescheduleSuccessSlot] = await prisma.$transaction(async (tx) => {
        const createdPrimarySlot = await tx.availabilitySlot.create({
          data: {
            startsAt: primaryStart,
            endsAt: primaryEnd,
            capacity: 1,
            status: AvailabilitySlotStatus.PUBLISHED,
            serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.SELECTED,
            publishedAt: new Date(),
            publicNote: `E2E primary ${runId}`,
            allowedServices: {
              create: {
                serviceId: service.id,
              },
            },
          },
        });
        const createdRescheduleSlot = await tx.availabilitySlot.create({
          data: {
            startsAt: rescheduleStart,
            endsAt: rescheduleSuccessStart,
            capacity: 1,
            status: AvailabilitySlotStatus.PUBLISHED,
            serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.SELECTED,
            publishedAt: new Date(),
            publicNote: rescheduleConflictPublicNote,
            allowedServices: {
              create: {
                serviceId: service.id,
              },
            },
          },
        });
        const createdRescheduleSuccessSlot = await tx.availabilitySlot.create({
          data: {
            startsAt: rescheduleSuccessStart,
            endsAt: rescheduleEnd,
            capacity: 1,
            status: AvailabilitySlotStatus.PUBLISHED,
            serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.SELECTED,
            publishedAt: new Date(),
            publicNote: rescheduleSuccessPublicNote,
            allowedServices: {
              create: {
                serviceId: service.id,
              },
            },
          },
        });

        return [createdPrimarySlot, createdRescheduleSlot, createdRescheduleSuccessSlot];
      });
      break;
    } catch (error) {
      if (!isAvailabilitySlotWindowConflict(error) || attempt === 95) {
        throw error;
      }
    }
  }

  if (!primarySlot || !rescheduleSlot || !rescheduleSuccessSlot) {
    throw new Error(`Could not create non-overlapping E2E availability slots for ${runId}.`);
  }

  return {
    category,
    service,
    primarySlot,
    primaryStart,
    primaryEnd,
    rescheduleSlot,
    rescheduleSuccessSlot,
    rescheduleStart,
    rescheduleEnd,
    categoryName,
    serviceName,
    serviceSlug,
  };
}

export async function createPublicBookingFixture(): Promise<E2eFixture> {
  await resetE2eRecentAuditRateLimitState();

  const runId = buildRunId();
  const catalog = await createCatalogFixture(runId);
  const rescheduleSuccessStart = addMinutes(catalog.rescheduleStart, 60);
  const rescheduleSuccessEnd = addMinutes(rescheduleSuccessStart, catalog.service.durationMinutes);
  const rescheduleDateLabel = formatPragueLongDateLabel(catalog.rescheduleStart);
  const rescheduleSuccessDateLabel = formatPragueLongDateLabel(rescheduleSuccessStart);

  return {
    runId,
    serviceName: catalog.serviceName,
    serviceSlug: catalog.serviceSlug,
    categoryName: catalog.categoryName,
    clientName: `E2E Klientka ${runId}`,
    clientEmail: `${runId}@example.test`,
    slotLabels: {
      primaryDateKey: formatPragueDateKey(catalog.primaryStart),
      primaryTime: formatPragueTime(catalog.primaryStart),
      rescheduleDateKey: formatPragueDateKey(catalog.rescheduleStart),
      rescheduleTime: formatPragueTime(catalog.rescheduleStart),
      rescheduleConflictButtonLabel: `Vybrat čas ${formatPragueTimeRange(catalog.rescheduleStart, addMinutes(catalog.rescheduleStart, catalog.service.durationMinutes))} dne ${rescheduleDateLabel}`,
      rescheduleConflictSlotId: catalog.rescheduleSlot.id,
      rescheduleSuccessButtonLabel: `Vybrat čas ${formatPragueTimeRange(rescheduleSuccessStart, rescheduleSuccessEnd)} dne ${rescheduleSuccessDateLabel}`,
      rescheduleSuccessSlotId: catalog.rescheduleSuccessSlot.id,
      rescheduleSuccessStartAt: rescheduleSuccessStart.toISOString(),
      primaryStartAt: catalog.primaryStart.toISOString(),
      rescheduleStartAt: catalog.rescheduleStart.toISOString(),
    },
  };
}

export async function createManagedBookingFixture(
  status: BookingStatus = BookingStatus.CONFIRMED,
  options?: {
    createRescheduleConflict?: boolean;
  },
): Promise<E2eFixture> {
  await resetE2eRecentAuditRateLimitState();

  const runId = buildRunId();
  const catalog = await createCatalogFixture(runId);
  const clientName = `E2E Klientka ${runId}`;
  const clientEmail = `${runId}@example.test`;
  const rescheduleSuccessStart = addMinutes(catalog.rescheduleStart, 60);
  const rescheduleSuccessEnd = addMinutes(rescheduleSuccessStart, catalog.service.durationMinutes);
  const rescheduleDateLabel = formatPragueLongDateLabel(catalog.rescheduleStart);
  const rescheduleSuccessDateLabel = formatPragueLongDateLabel(rescheduleSuccessStart);

  const client = await prisma.client.create({
    data: {
      fullName: clientName,
      email: clientEmail,
      phone: "+420777000000",
      lastBookedAt: catalog.primaryStart,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: catalog.primarySlot.id,
      serviceId: catalog.service.id,
      source: BookingSource.WEB,
      status,
      clientNameSnapshot: clientName,
      clientEmailSnapshot: clientEmail,
      clientPhoneSnapshot: client.phone,
      serviceNameSnapshot: catalog.service.name,
      serviceDurationMinutes: catalog.service.durationMinutes,
      servicePriceFromCzk: catalog.service.priceFromCzk,
      scheduledStartsAt: catalog.primaryStart,
      scheduledEndsAt: addMinutes(catalog.primaryStart, catalog.service.durationMinutes),
      confirmedAt: status === BookingStatus.CONFIRMED ? new Date() : null,
      statusHistory: {
        create: {
          status,
          actorType: BookingActorType.SYSTEM,
          note: "E2E fixture",
        },
      },
    },
  });

  if (options?.createRescheduleConflict) {
    const conflictEmail = `${runId}-conflict@example.test`;
    const conflictStart = addMinutes(catalog.primaryStart, catalog.service.durationMinutes);
    const conflictClient = await prisma.client.create({
      data: {
        fullName: `E2E Kolize ${runId}`,
        email: conflictEmail,
        phone: "+420777000001",
        lastBookedAt: conflictStart,
      },
    });

    await prisma.booking.create({
      data: {
        clientId: conflictClient.id,
        slotId: catalog.primarySlot.id,
        serviceId: catalog.service.id,
        source: BookingSource.WEB,
        status: BookingStatus.CONFIRMED,
        clientNameSnapshot: conflictClient.fullName,
        clientEmailSnapshot: conflictEmail,
        clientPhoneSnapshot: conflictClient.phone,
        serviceNameSnapshot: catalog.service.name,
        serviceDurationMinutes: catalog.service.durationMinutes,
        servicePriceFromCzk: catalog.service.priceFromCzk,
        scheduledStartsAt: conflictStart,
        scheduledEndsAt: addMinutes(conflictStart, catalog.service.durationMinutes),
        confirmedAt: new Date(),
        statusHistory: {
          create: {
            status: BookingStatus.CONFIRMED,
            actorType: BookingActorType.SYSTEM,
            note: "E2E fixture conflict booking",
          },
        },
      },
    });
  }

  const cancelToken = buildBookingActionToken();
  const manageToken = buildBookingActionToken();

  await prisma.bookingActionToken.createMany({
    data: [
      {
        bookingId: booking.id,
        type: BookingActionTokenType.CANCEL,
        tokenHash: cancelToken.tokenHash,
        expiresAt: buildBookingSelfServiceActionExpiry(catalog.primaryStart),
      },
      {
        bookingId: booking.id,
        type: BookingActionTokenType.RESCHEDULE,
        tokenHash: manageToken.tokenHash,
        expiresAt: buildBookingSelfServiceActionExpiry(catalog.primaryStart),
      },
    ],
  });

  return {
    runId,
    serviceName: catalog.serviceName,
    serviceSlug: catalog.serviceSlug,
    categoryName: catalog.categoryName,
    clientName,
    clientEmail,
    clientId: client.id,
    bookingId: booking.id,
    cancelToken: cancelToken.rawToken,
    manageToken: manageToken.rawToken,
    slotLabels: {
      primaryDateKey: formatPragueDateKey(catalog.primaryStart),
      primaryTime: formatPragueTime(catalog.primaryStart),
      rescheduleDateKey: formatPragueDateKey(catalog.rescheduleStart),
      rescheduleTime: formatPragueTime(catalog.rescheduleStart),
      rescheduleConflictButtonLabel: `Vybrat čas ${formatPragueTimeRange(catalog.rescheduleStart, addMinutes(catalog.rescheduleStart, catalog.service.durationMinutes))} dne ${rescheduleDateLabel}`,
      rescheduleConflictSlotId: catalog.rescheduleSlot.id,
      rescheduleSuccessButtonLabel: `Vybrat čas ${formatPragueTimeRange(rescheduleSuccessStart, rescheduleSuccessEnd)} dne ${rescheduleSuccessDateLabel}`,
      rescheduleSuccessSlotId: catalog.rescheduleSuccessSlot.id,
      rescheduleSuccessStartAt: rescheduleSuccessStart.toISOString(),
      primaryStartAt: catalog.primaryStart.toISOString(),
      rescheduleStartAt: catalog.rescheduleStart.toISOString(),
    },
  };
}

export async function createAdminFixture(runId: string, role: AdminRole = AdminRole.OWNER) {
  await resetE2eRecentAuditRateLimitState();

  const password = `E2E-password-${runId}`;
  const email = `${runId}-${role.toLowerCase()}@example.test`;

  await prisma.adminUser.create({
    data: {
      email,
      name: `E2E ${role} ${runId}`,
      role,
      passwordHash: await hashPassword(password),
      isActive: true,
    },
  });

  return { email, password };
}

export async function createFragmentedCancellationFixture(): Promise<FragmentedCancellationFixture> {
  await resetE2eRecentAuditRateLimitState();

  const runId = buildRunId();
  const catalog = await createCatalogFixture(runId);
  const admin = await createAdminFixture(runId, AdminRole.OWNER);
  const clientName = `E2E Fragment ${runId}`;
  const clientEmail = `${runId}-fragment@example.test`;
  const clientPhone = "+420777000222";

  await prisma.availabilitySlot.deleteMany({
    where: {
      OR: [
        { id: catalog.primarySlot.id },
        { id: catalog.rescheduleSlot.id },
        { id: catalog.rescheduleSuccessSlot.id },
      ],
    },
  });

  const siteSettings = await prisma.siteSettings.findUnique({
    where: { id: "site-settings" },
    select: {
      bookingMinAdvanceHours: true,
      bookingCancellationHours: true,
    },
  });
  const minAdvanceHours = siteSettings?.bookingMinAdvanceHours ?? 2;
  const cancellationHours = siteSettings?.bookingCancellationHours ?? 48;
  const baseLeadHours = Math.max(minAdvanceHours + 3, cancellationHours + 3);
  const firstCandidate = buildPolicySafeStart(baseLeadHours);

  let beforeWindowStart = firstCandidate;
  let beforeWindowEnd = addMinutes(beforeWindowStart, 30);
  let bookingStart = beforeWindowEnd;
  let bookingEnd = addMinutes(bookingStart, catalog.service.durationMinutes);
  let afterWindowStart = bookingEnd;
  let afterWindowEnd = addMinutes(afterWindowStart, 30);
  let beforeSlot: { id: string } | null = null;
  let bookedSlot: { id: string } | null = null;
  let afterSlot: { id: string } | null = null;

  for (let attempt = 0; attempt < 21; attempt += 1) {
    beforeWindowStart = addMinutes(firstCandidate, attempt * 24 * 60);
    beforeWindowEnd = addMinutes(beforeWindowStart, 30);
    bookingStart = beforeWindowEnd;
    bookingEnd = addMinutes(bookingStart, catalog.service.durationMinutes);
    afterWindowStart = bookingEnd;
    afterWindowEnd = addMinutes(afterWindowStart, 30);

    try {
      [beforeSlot, bookedSlot, afterSlot] = await prisma.$transaction([
        prisma.availabilitySlot.create({
          data: {
            startsAt: beforeWindowStart,
            endsAt: beforeWindowEnd,
            capacity: 1,
            status: AvailabilitySlotStatus.PUBLISHED,
            serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.ANY,
            publishedAt: new Date(),
          },
          select: { id: true },
        }),
        prisma.availabilitySlot.create({
          data: {
            startsAt: bookingStart,
            endsAt: bookingEnd,
            capacity: 1,
            status: AvailabilitySlotStatus.PUBLISHED,
            serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.ANY,
            publishedAt: new Date(),
          },
          select: { id: true },
        }),
        prisma.availabilitySlot.create({
          data: {
            startsAt: afterWindowStart,
            endsAt: afterWindowEnd,
            capacity: 1,
            status: AvailabilitySlotStatus.PUBLISHED,
            serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.ANY,
            publishedAt: new Date(),
          },
          select: { id: true },
        }),
      ]);
      break;
    } catch (error) {
      if (!isAvailabilitySlotWindowConflict(error) || attempt === 20) {
        throw error;
      }
    }
  }

  if (!beforeSlot || !bookedSlot || !afterSlot) {
    throw new Error(`Could not create fragmented cancellation fixture slots for ${runId}.`);
  }

  const client = await prisma.client.create({
    data: {
      fullName: clientName,
      email: clientEmail,
      phone: clientPhone,
      lastBookedAt: bookingStart,
    },
    select: { id: true },
  });

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: bookedSlot.id,
      serviceId: catalog.service.id,
      source: BookingSource.WEB,
      status: BookingStatus.CONFIRMED,
      clientNameSnapshot: clientName,
      clientEmailSnapshot: clientEmail,
      clientPhoneSnapshot: clientPhone,
      serviceNameSnapshot: catalog.service.name,
      serviceDurationMinutes: catalog.service.durationMinutes,
      servicePriceFromCzk: catalog.service.priceFromCzk,
      scheduledStartsAt: bookingStart,
      scheduledEndsAt: bookingEnd,
      confirmedAt: new Date(),
      statusHistory: {
        create: {
          status: BookingStatus.CONFIRMED,
          actorType: BookingActorType.SYSTEM,
          note: "E2E fragmented cancellation fixture",
        },
      },
    },
    select: { id: true },
  });

  const cancelToken = buildBookingActionToken();
  const manageToken = buildBookingActionToken();

  await prisma.bookingActionToken.createMany({
    data: [
      {
        bookingId: booking.id,
        type: BookingActionTokenType.CANCEL,
        tokenHash: cancelToken.tokenHash,
        expiresAt: buildBookingSelfServiceActionExpiry(bookingStart),
      },
      {
        bookingId: booking.id,
        type: BookingActionTokenType.RESCHEDULE,
        tokenHash: manageToken.tokenHash,
        expiresAt: buildBookingSelfServiceActionExpiry(bookingStart),
      },
    ],
  });

  return {
    runId,
    serviceName: catalog.serviceName,
    serviceSlug: catalog.serviceSlug,
    categoryName: catalog.categoryName,
    clientName,
    clientEmail,
    clientId: client.id,
    bookingId: booking.id,
    cancelToken: cancelToken.rawToken,
    manageToken: manageToken.rawToken,
    adminEmail: admin.email,
    adminPassword: admin.password,
    planner: {
      weekKey: formatDateKey(resolveWeekStart(formatPragueDateKey(beforeWindowStart))),
      dayKey: formatPragueDateKey(beforeWindowStart),
      beforeCancellationWindows: [
        formatPragueTimeRange(beforeWindowStart, beforeWindowEnd),
        formatPragueTimeRange(afterWindowStart, afterWindowEnd),
      ],
      afterCancellationWindow: formatPragueTimeRange(beforeWindowStart, afterWindowEnd),
    },
    slotLabels: {
      primaryDateKey: formatPragueDateKey(beforeWindowStart),
      primaryTime: formatPragueTime(beforeWindowStart),
      rescheduleDateKey: formatPragueDateKey(bookingStart),
      rescheduleTime: formatPragueTime(bookingStart),
      rescheduleConflictButtonLabel: "",
      rescheduleConflictSlotId: beforeSlot.id,
      rescheduleSuccessButtonLabel: "",
      rescheduleSuccessSlotId: afterSlot.id,
      rescheduleSuccessStartAt: afterWindowStart.toISOString(),
      primaryStartAt: beforeWindowStart.toISOString(),
      rescheduleStartAt: bookingStart.toISOString(),
    },
  };
}

export async function createPublicVoucherFixture(): Promise<E2eFixture> {
  await resetE2eRecentAuditRateLimitState();

  const runId = buildRunId();
  const voucherCode = `PP-2026-${runId.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()}`;

  await prisma.voucher.create({
    data: {
      code: voucherCode,
      type: VoucherType.VALUE,
      status: VoucherStatus.ACTIVE,
      purchaserEmail: `${runId}@secret.example.test`,
      originalValueCzk: 1500,
      remainingValueCzk: 1500,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2026-12-31T23:59:59.000Z"),
      issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      internalNote: `E2E tajná poznámka ${runId}`,
    },
  });

  return {
    runId,
    voucherCode,
    serviceName: "",
    serviceSlug: "",
    categoryName: "",
    clientName: "",
    clientEmail: "",
    slotLabels: {
      primaryDateKey: "",
      primaryTime: "",
      rescheduleDateKey: "",
      rescheduleTime: "",
      rescheduleConflictButtonLabel: "",
      rescheduleConflictSlotId: "",
      rescheduleSuccessButtonLabel: "",
      rescheduleSuccessSlotId: "",
      rescheduleSuccessStartAt: "",
      primaryStartAt: "",
      rescheduleStartAt: "",
    },
  };
}

export async function cleanupE2eData(runId: string) {
  const services = await prisma.service.findMany({
    where: {
      slug: {
        contains: runId,
      },
    },
    select: {
      id: true,
      categoryId: true,
    },
  });
  const serviceIds = services.map((service) => service.id);
  const categoryIds = [...new Set(services.map((service) => service.categoryId))];
  const clients = await prisma.client.findMany({
    where: {
      email: {
        contains: runId,
      },
    },
    select: {
      id: true,
    },
  });
  const clientIds = clients.map((client) => client.id);
  const bookingCleanupFilters = [
    ...(serviceIds.length > 0 ? [{ serviceId: { in: serviceIds } }] : []),
    ...(clientIds.length > 0 ? [{ clientId: { in: clientIds } }] : []),
  ];
  const bookings = bookingCleanupFilters.length > 0 ? await prisma.booking.findMany({
    where: {
      OR: bookingCleanupFilters,
    },
    select: {
      id: true,
      slotId: true,
    },
  }) : [];
  const bookingIds = bookings.map((booking) => booking.id);
  const bookingSlotIds = bookings.map((booking) => booking.slotId);
  const actionTokens = await prisma.bookingActionToken.findMany({
    where: {
      bookingId: {
        in: bookingIds,
      },
    },
    select: {
      id: true,
    },
  });
  const actionTokenIds = actionTokens.map((token) => token.id);
  const slots = await prisma.availabilitySlot.findMany({
    where: {
      OR: [
        {
          publicNote: {
            contains: runId,
          },
        },
        ...(bookingSlotIds.length > 0 ? [{ id: { in: bookingSlotIds } }] : []),
      ],
    },
    select: {
      id: true,
    },
  });
  const slotIds = slots.map((slot) => slot.id);

  await prisma.voucherRedemption.deleteMany({
    where: {
      voucher: {
        internalNote: {
          contains: runId,
        },
      },
    },
  });
  await prisma.voucherChangeLog.deleteMany({
    where: {
      OR: [
        { voucher: { internalNote: { contains: runId } } },
        { actorUser: { email: { contains: runId } } },
      ],
    },
  });
  await prisma.voucher.deleteMany({
    where: {
      internalNote: {
        contains: runId,
      },
    },
  });

  await prisma.emailLog.deleteMany({
    where: {
      OR: [
        { recipientEmail: { contains: runId } },
        ...(bookingIds.length > 0 ? [{ bookingId: { in: bookingIds } }] : []),
        ...(clientIds.length > 0 ? [{ clientId: { in: clientIds } }] : []),
        ...(actionTokenIds.length > 0 ? [{ actionTokenId: { in: actionTokenIds } }] : []),
      ],
    },
  });

  const submissionCleanupFilters = [
    ...(bookingIds.length > 0 ? [{ bookingId: { in: bookingIds } }] : []),
    ...(clientIds.length > 0 ? [{ clientId: { in: clientIds } }] : []),
    ...(serviceIds.length > 0 ? [{ serviceId: { in: serviceIds } }] : []),
    ...(slotIds.length > 0 ? [{ slotId: { in: slotIds } }] : []),
  ];

  if (submissionCleanupFilters.length > 0) {
    await prisma.bookingSubmissionLog.deleteMany({
      where: {
        OR: submissionCleanupFilters,
      },
    });
  }
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  const slotServiceCleanupFilters = [
    ...(slotIds.length > 0 ? [{ slotId: { in: slotIds } }] : []),
    ...(serviceIds.length > 0 ? [{ serviceId: { in: serviceIds } }] : []),
  ];

  if (slotServiceCleanupFilters.length > 0) {
    await prisma.availabilitySlotService.deleteMany({
      where: {
        OR: slotServiceCleanupFilters,
      },
    });
  }
  await prisma.availabilitySlot.deleteMany({ where: { id: { in: slotIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.serviceChangeLog.deleteMany({
    where: {
      OR: [
        ...(serviceIds.length > 0 ? [{ serviceId: { in: serviceIds } }] : []),
        { actorUser: { email: { contains: runId } } },
      ],
    },
  });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.serviceCategory.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.siteSettingsChangeLog.deleteMany({ where: { actorUser: { email: { contains: runId } } } });
  await prisma.adminUserAuditEvent.deleteMany({
    where: {
      OR: [
        { targetUser: { email: { contains: runId } } },
        { actorUser: { email: { contains: runId } } },
      ],
    },
  });
  await prisma.adminUser.deleteMany({
    where: {
      email: {
        contains: runId,
      },
    },
  });
}

export { prisma };
