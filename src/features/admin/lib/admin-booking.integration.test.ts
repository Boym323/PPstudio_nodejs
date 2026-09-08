import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  AvailabilitySlotStatus,
  BookingActorType,
  BookingActionTokenType,
  BookingSource,
  BookingStatus,
  EmailAudience,
  EmailLogStatus,
  EmailLogType,
} from "@/generated/prisma/browser";
import { Prisma } from "@/generated/prisma/client";
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

const dbTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(value.getUTCFullYear()).padStart(4, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function at(localDate: string, time: string) {
  const value = resolvePragueLocalDateTime(localDate, time);
  assert.ok(value);
  return value;
}

async function findIsolatedAdminWindow(
  prisma: Awaited<typeof import("@/lib/prisma")>["prisma"],
  seed: string,
  durationMinutes: number,
  options: { isolateReminderScan?: boolean } = {},
) {
  const daySeed = Number.parseInt(seed.slice(0, 4), 16);
  const hourSeed = Number.parseInt(seed.slice(4, 6), 16);
  const minuteSeed = Number.parseInt(seed.slice(6, 8), 16);
  const hourCandidates = [7, 8, 9, 10, 11, 12, 13, 14].map(
    (hour, index, list) => list[(index + hourSeed) % list.length] ?? hour,
  );
  const minuteCandidates = [0, 15, 30].map(
    (minute, index, list) => list[(index + minuteSeed) % list.length] ?? minute,
  );
  const now = new Date();

  for (let dayStep = 0; dayStep < 45; dayStep += 1) {
    const dayOffset = 14 + ((daySeed + dayStep) % 45);

    for (const hour of hourCandidates) {
      for (const minute of minuteCandidates) {
        const startsAt = new Date(now);
        startsAt.setUTCSeconds(0, 0);
        startsAt.setUTCDate(startsAt.getUTCDate() + dayOffset);
        startsAt.setUTCHours(hour, minute, 0, 0);
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

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
          if (options.isolateReminderScan) {
            const reminderScanAt = new Date(startsAt.getTime() - 25.5 * 60 * 60 * 1000);
            const reminderWindowEnd = new Date(reminderScanAt.getTime() + 26 * 60 * 60 * 1000);
            const otherReminderBookings = await prisma.booking.count({
              where: {
                status: BookingStatus.CONFIRMED,
                clientEmailSnapshot: { not: "" },
                reminder24hSentAt: null,
                scheduledStartsAt: {
                  gt: reminderScanAt,
                  lte: reminderWindowEnd,
                },
              },
            });

            if (otherReminderBookings > 0) continue;
          }

          return { startsAt, endsAt };
        }
      }
    }
  }

  throw new Error("Nepodařilo se najít izolované okno pro admin booking integrační test.");
}

async function disableAutoLunchForAdminFixture(
  prisma: Awaited<typeof import("@/lib/prisma")>["prisma"],
  localDate: string,
  ownerId: string,
) {
  const existingOverride = await prisma.autoLunchDayOverride.findUnique({
    where: { dateKey: localDate },
    select: { dateKey: true },
  });

  if (existingOverride) return false;

  await prisma.autoLunchDayOverride.create({
    data: { dateKey: localDate, updatedByUserId: ownerId },
  });
  return true;
}

async function createAdminServiceChangeFixture(
  prisma: Awaited<typeof import("@/lib/prisma")>["prisma"],
  suffix: string,
  options: { isolateReminderScan?: boolean } = {},
) {
  const isolatedWindow = await findIsolatedAdminWindow(prisma, suffix, 120, options);
  const { startsAt, endsAt } = isolatedWindow;
  const bookingEndsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const owner = await prisma.adminUser.create({
    data: {
      email: `owner-service-change-${suffix}@example.com`,
      name: `Owner service change ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });
  const autoLunchOverrideCreated = await disableAutoLunchForAdminFixture(
    prisma,
    getPragueLocalDate(startsAt),
    owner.id,
  );
  const category = await prisma.serviceCategory.create({
    data: {
      name: `Kategorie změny služby ${suffix}`,
      slug: `kategorie-zmeny-sluzby-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });
  const [originalService, replacementService] = await Promise.all([
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Původní změna služby ${suffix}`,
        slug: `puvodni-zmena-sluzby-${suffix}`,
        durationMinutes: 60,
        priceFromCzk: 1200,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Delší změna služby ${suffix}`,
        slug: `delsi-zmena-sluzby-${suffix}`,
        durationMinutes: 90,
        priceFromCzk: 1500,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
  ]);
  const slot = await prisma.availabilitySlot.create({
    data: {
      startsAt,
      endsAt,
      status: "PUBLISHED",
      capacity: 1,
      serviceRestrictionMode: "ANY",
      publishedAt: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const client = await prisma.client.create({
    data: {
      fullName: `Klientka změny služby ${suffix}`,
      email: `client-service-change-${suffix}@example.com`,
      phone: "+420777123456",
      isActive: true,
    },
    select: { id: true },
  });
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: slot.id,
      serviceId: originalService.id,
      status: BookingStatus.CONFIRMED,
      source: "WEB",
      clientNameSnapshot: `Klientka změny služby ${suffix}`,
      clientEmailSnapshot: `client-service-change-${suffix}@example.com`,
      clientPhoneSnapshot: "+420777123456",
      serviceNameSnapshot: `Původní změna služby ${suffix}`,
      serviceDurationMinutes: 60,
      servicePriceFromCzk: 1200,
      scheduledStartsAt: startsAt,
      scheduledEndsAt: bookingEndsAt,
      blockedUntil: bookingEndsAt,
    },
    select: { id: true, updatedAt: true },
  });

  return {
    startsAt,
    endsAt,
    bookingEndsAt,
    owner,
    category,
    originalService,
    replacementService,
    slot,
    client,
    booking,
    async cleanup() {
      const serviceIds = [originalService.id, replacementService.id];
      await prisma.bookingActionToken.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.emailLog.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.bookingStatusHistory.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.booking.deleteMany({ where: { serviceId: { in: serviceIds } } });
      await prisma.client.deleteMany({
        where: {
          OR: [
            { email: { contains: suffix } },
            { email: { startsWith: `concurrent-service-change-${booking.id}@` } },
          ],
        },
      });
      await prisma.availabilitySlot.deleteMany({
        where: { startsAt: { gte: startsAt, lt: endsAt } },
      });
      if (autoLunchOverrideCreated) {
        await prisma.autoLunchDayOverride.deleteMany({
          where: { dateKey: getPragueLocalDate(startsAt), updatedByUserId: owner.id },
        });
      }
      await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
      await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
      await prisma.adminUser.deleteMany({ where: { id: owner.id } });
    },
  };
}

async function createAdminManualOverrideResizeFixture(
  prisma: Awaited<typeof import("@/lib/prisma")>["prisma"],
  suffix: string,
  options: {
    originalDurationMinutes?: number;
    originalCleanupMinutes?: number;
  } = {},
) {
  const { startsAt: baseStartsAt, endsAt: baseEndsAt } = await findIsolatedAdminWindow(prisma, suffix, 180);
  const originalDurationMinutes = options.originalDurationMinutes ?? 60;
  const originalCleanupMinutes = options.originalCleanupMinutes ?? 0;
  const cleanupBlockMinutes = Math.ceil(originalCleanupMinutes / 15) * 15;
  const manualStartsAt = new Date(baseStartsAt.getTime() + 30 * 60 * 1000);
  const originalAvailabilityStartsAt = new Date(baseStartsAt.getTime() + 60 * 60 * 1000);
  const originalAvailabilityEndsAt = new Date(baseStartsAt.getTime() + 120 * 60 * 1000);
  const manualEndsAt = new Date(
    manualStartsAt.getTime() + (originalDurationMinutes + cleanupBlockMinutes) * 60 * 1000,
  );
  const owner = await prisma.adminUser.create({
    data: {
      email: `owner-manual-resize-${suffix}@example.com`,
      name: `Owner manual resize ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });
  const autoLunchOverrideCreated = await disableAutoLunchForAdminFixture(
    prisma,
    getPragueLocalDate(manualStartsAt),
    owner.id,
  );
  const category = await prisma.serviceCategory.create({
    data: {
      name: `Kategorie manual resize ${suffix}`,
      slug: `kategorie-manual-resize-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });
  const [originalService, shortService, longService] = await Promise.all([
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Původní manual resize ${suffix}`,
        slug: `puvodni-manual-resize-${suffix}`,
        durationMinutes: originalDurationMinutes,
        cleanupMinutes: originalCleanupMinutes,
        priceFromCzk: 1200,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Kratší manual resize ${suffix}`,
        slug: `kratsi-manual-resize-${suffix}`,
        durationMinutes: originalDurationMinutes === 60 ? 30 : originalDurationMinutes,
        priceFromCzk: 1300,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Delší manual resize ${suffix}`,
        slug: `delsi-manual-resize-${suffix}`,
        durationMinutes: 60,
        priceFromCzk: 1400,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
  ]);
  const originSlot = await prisma.availabilitySlot.create({
    data: {
      startsAt: originalAvailabilityStartsAt,
      endsAt: originalAvailabilityEndsAt,
      status: "PUBLISHED",
      capacity: 1,
      serviceRestrictionMode: "ANY",
      publishedAt: new Date(baseStartsAt.getTime() - 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  await prisma.availabilitySlot.update({
    where: { id: originSlot.id },
    data: { status: "ARCHIVED" },
  });
  const manualOverrideSlot = await prisma.availabilitySlot.create({
    data: {
      startsAt: manualStartsAt,
      endsAt: manualEndsAt,
      status: "DRAFT",
      capacity: 1,
      serviceRestrictionMode: "ANY",
      internalNote: "Dočasná ruční výjimka",
      createdByUserId: owner.id,
    },
    select: { id: true },
  });
  const rightPublishedSlot = await prisma.availabilitySlot.create({
    data: {
      startsAt: manualEndsAt,
      endsAt: originalAvailabilityEndsAt,
      status: "PUBLISHED",
      capacity: 1,
      serviceRestrictionMode: "ANY",
      publishedAt: new Date(baseStartsAt.getTime() - 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const client = await prisma.client.create({
    data: {
      fullName: `Klientka manual resize ${suffix}`,
      email: `client-manual-resize-${suffix}@example.com`,
      phone: "+420777123456",
      isActive: true,
    },
    select: { id: true },
  });
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: manualOverrideSlot.id,
      serviceId: originalService.id,
      status: BookingStatus.CONFIRMED,
      source: BookingSource.PHONE,
      isManual: true,
      manualOverride: true,
      clientNameSnapshot: `Klientka manual resize ${suffix}`,
      clientEmailSnapshot: `client-manual-resize-${suffix}@example.com`,
      clientPhoneSnapshot: "+420777123456",
      serviceNameSnapshot: `Původní manual resize ${suffix}`,
      serviceDurationMinutes: originalDurationMinutes,
      cleanupMinutes: originalCleanupMinutes,
      cleanupBlockMinutes,
      servicePriceFromCzk: 1200,
      scheduledStartsAt: manualStartsAt,
      scheduledEndsAt: new Date(manualStartsAt.getTime() + originalDurationMinutes * 60 * 1000),
      blockedUntil: manualEndsAt,
    },
    select: { id: true, updatedAt: true },
  });

  return {
    baseStartsAt,
    baseEndsAt,
    manualStartsAt,
    manualEndsAt,
    originalAvailabilityStartsAt,
    originalAvailabilityEndsAt,
    owner,
    category,
    originalService,
    shortService,
    longService,
    originSlot,
    manualOverrideSlot,
    rightPublishedSlot,
    client,
    booking,
    async cleanup() {
      const serviceIds = [originalService.id, shortService.id, longService.id];
      await prisma.bookingActionToken.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.emailLog.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.bookingStatusHistory.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.bookingRescheduleLog.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.booking.deleteMany({ where: { serviceId: { in: serviceIds } } });
      await prisma.client.deleteMany({ where: { id: client.id } });
      await prisma.availabilitySlot.deleteMany({
        where: {
          startsAt: {
            gte: baseStartsAt,
            lt: new Date(baseEndsAt.getTime() + 120 * 60 * 1000),
          },
        },
      });
      if (autoLunchOverrideCreated) {
        await prisma.autoLunchDayOverride.deleteMany({
          where: { dateKey: getPragueLocalDate(manualStartsAt), updatedByUserId: owner.id },
        });
      }
      await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
      await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
      await prisma.adminUser.deleteMany({ where: { id: owner.id } });
    },
  };
}

async function findIsolatedAdminAutoLunchDate(
  prisma: Awaited<typeof import("@/lib/prisma")>["prisma"],
) {
  const today = getPragueLocalDate(new Date());

  for (let offset = 14; offset < 75; offset += 1) {
    const localDate = addCalendarDays(today, offset);
    const nextLocalDate = getNextCalendarDate(localDate);
    assert.ok(nextLocalDate);
    const dayStartsAt = at(localDate, "00:00");
    const dayEndsAt = at(nextLocalDate, "00:00");
    const [slotCount, bookingCount, overrideCount] = await Promise.all([
      prisma.availabilitySlot.count({
        where: { startsAt: { lt: dayEndsAt }, endsAt: { gt: dayStartsAt } },
      }),
      prisma.booking.count({
        where: {
          scheduledStartsAt: { lt: dayEndsAt },
          OR: [
            { blockedUntil: { gt: dayStartsAt } },
            { blockedUntil: null, scheduledEndsAt: { gt: dayStartsAt } },
          ],
        },
      }),
      prisma.autoLunchDayOverride.count({ where: { dateKey: localDate } }),
    ]);

    if (slotCount === 0 && bookingCount === 0 && overrideCount === 0) return localDate;
  }

  throw new Error("Nepodařilo se najít izolovaný den pro admin auto-lunch integrační test.");
}

async function createAdminAutoLunchServiceChangeFixture(
  prisma: Awaited<typeof import("@/lib/prisma")>["prisma"],
  suffix: string,
  options: {
    originalDurationMinutes: number;
    replacementDurationMinutes: number;
    activeAutoLunch: boolean;
  },
) {
  const localDate = await findIsolatedAdminAutoLunchDate(prisma);
  const startsAt = at(localDate, "10:30");
  const bookingEndsAt = new Date(startsAt.getTime() + options.originalDurationMinutes * 60 * 1000);
  const availabilityWindows = options.activeAutoLunch
    ? [["07:00", "10:00"], ["10:30", "12:45"], ["14:00", "17:00"]]
    : [["10:30", "12:45"]];

  const owner = await prisma.adminUser.create({
    data: {
      email: `owner-admin-auto-lunch-${suffix}@example.com`,
      name: `Owner admin auto lunch ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });
  const { ensureSiteSettings } = await import("@/lib/site-settings");
  const siteSettings = await ensureSiteSettings();
  await prisma.siteSettings.update({
    where: { id: "site-settings" },
    data: { autoLunchEnabled: true },
  });
  const autoLunchOverrideCreated = !options.activeAutoLunch;
  if (autoLunchOverrideCreated) {
    await prisma.autoLunchDayOverride.create({
      data: { dateKey: localDate, updatedByUserId: owner.id },
    });
  }
  const category = await prisma.serviceCategory.create({
    data: {
      name: `Kategorie admin auto lunch ${suffix}`,
      slug: `kategorie-admin-auto-lunch-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });
  const [originalService, replacementService] = await Promise.all([
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Původní admin auto lunch ${suffix}`,
        slug: `puvodni-admin-auto-lunch-${suffix}`,
        durationMinutes: options.originalDurationMinutes,
        priceFromCzk: 1200,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Nová admin auto lunch ${suffix}`,
        slug: `nova-admin-auto-lunch-${suffix}`,
        durationMinutes: options.replacementDurationMinutes,
        priceFromCzk: 1500,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
  ]);
  const slots = await Promise.all(
    availabilityWindows.map(([slotStartsAt, slotEndsAt]) => prisma.availabilitySlot.create({
      data: {
        startsAt: at(localDate, slotStartsAt),
        endsAt: at(localDate, slotEndsAt),
        status: "PUBLISHED",
        capacity: 1,
        serviceRestrictionMode: "ANY",
        publishedAt: new Date(),
      },
      select: { id: true },
    })),
  );
  const bookingSlot = slots[1] ?? slots[0];
  assert.ok(bookingSlot);
  const client = await prisma.client.create({
    data: {
      fullName: `Klientka admin auto lunch ${suffix}`,
      email: `client-admin-auto-lunch-${suffix}@example.com`,
      phone: "+420777123456",
      isActive: true,
    },
    select: { id: true },
  });
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: bookingSlot.id,
      serviceId: originalService.id,
      status: BookingStatus.CONFIRMED,
      source: "WEB",
      clientNameSnapshot: `Klientka admin auto lunch ${suffix}`,
      clientEmailSnapshot: `client-admin-auto-lunch-${suffix}@example.com`,
      clientPhoneSnapshot: "+420777123456",
      serviceNameSnapshot: `Původní admin auto lunch ${suffix}`,
      serviceDurationMinutes: options.originalDurationMinutes,
      servicePriceFromCzk: 1200,
      scheduledStartsAt: startsAt,
      scheduledEndsAt: bookingEndsAt,
      blockedUntil: bookingEndsAt,
    },
    select: { id: true, updatedAt: true },
  });

  return {
    localDate,
    startsAt,
    bookingEndsAt,
    owner,
    category,
    originalService,
    replacementService,
    slot: bookingSlot,
    booking,
    async cleanup() {
      const serviceIds = [originalService.id, replacementService.id];
      const slotIds = slots.map((slot) => slot.id);
      await prisma.bookingActionToken.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.emailLog.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.bookingStatusHistory.deleteMany({ where: { booking: { serviceId: { in: serviceIds } } } });
      await prisma.booking.deleteMany({ where: { serviceId: { in: serviceIds } } });
      await prisma.client.deleteMany({ where: { id: client.id } });
      await prisma.availabilitySlot.deleteMany({ where: { id: { in: slotIds } } });
      if (autoLunchOverrideCreated) {
        await prisma.autoLunchDayOverride.deleteMany({
          where: { dateKey: localDate, updatedByUserId: owner.id },
        });
      }
      await prisma.siteSettings.update({
        where: { id: "site-settings" },
        data: { autoLunchEnabled: siteSettings.autoLunchEnabled },
      });
      await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
      await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
      await prisma.adminUser.deleteMany({ where: { id: owner.id } });
    },
  };
}

async function createAdminCancellationFixture(
  prisma: Awaited<typeof import("@/lib/prisma")>["prisma"],
  suffix: string,
  email: string | null,
  snapshotEmail = email,
) {
  const { startsAt, endsAt } = await findIsolatedAdminWindow(prisma, suffix, 60);
  const owner = await prisma.adminUser.create({
    data: {
      email: `owner-admin-cancellation-${suffix}@example.com`,
      name: `Owner cancellation ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });
  const category = await prisma.serviceCategory.create({
    data: {
      name: `Kategorie admin cancellation ${suffix}`,
      slug: `kategorie-admin-cancellation-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });
  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Služba admin cancellation ${suffix}`,
      slug: `sluzba-admin-cancellation-${suffix}`,
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
    },
    select: { id: true },
  });
  const client = await prisma.client.create({
    data: {
      fullName: `Klientka admin cancellation ${suffix}`,
      email,
      phone: "+420777123456",
      isActive: true,
    },
    select: { id: true },
  });
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: slot.id,
      serviceId: service.id,
      status: BookingStatus.CONFIRMED,
      source: BookingSource.PHONE,
      clientNameSnapshot: `Klientka admin cancellation ${suffix}`,
      clientEmailSnapshot: snapshotEmail ?? "",
      clientPhoneSnapshot: "+420777123456",
      serviceNameSnapshot: `Služba admin cancellation ${suffix}`,
      serviceDurationMinutes: 60,
      servicePriceFromCzk: 1200,
      scheduledStartsAt: startsAt,
      scheduledEndsAt: endsAt,
    },
    select: { id: true },
  });

  return {
    owner,
    client,
    booking,
    slot,
    service,
    category,
    async cleanup() {
      await prisma.bookingActionToken.deleteMany({ where: { bookingId: booking.id } });
      await prisma.emailLog.deleteMany({ where: { bookingId: booking.id } });
      await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: booking.id } });
      await prisma.booking.deleteMany({ where: { id: booking.id } });
      await prisma.client.deleteMany({ where: { id: client.id } });
      await prisma.availabilitySlot.deleteMany({ where: { id: slot.id } });
      await prisma.service.deleteMany({ where: { id: service.id } });
      await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
      await prisma.adminUser.deleteMany({ where: { id: owner.id } });
    },
  };
}

dbTest("applyAdminBookingStatusChange confirms pending booking and writes side effects", async () => {
  const [{ prisma }, { applyAdminBookingStatusChange }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const { startsAt, endsAt } = await findIsolatedAdminWindow(prisma, suffix, 60);
  const confirmationNow = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);

  const owner = await prisma.adminUser.create({
    data: {
      email: `owner-booking-int-${suffix}@example.com`,
      name: `Owner ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Kategorie ${suffix}`,
      slug: `kategorie-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Služba ${suffix}`,
      slug: `sluzba-${suffix}`,
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
      status: "PUBLISHED",
      capacity: 1,
    },
    select: { id: true },
  });

  const client = await prisma.client.create({
    data: {
      fullName: `Klientka ${suffix}`,
      email: `client-booking-int-${suffix}@example.com`,
      phone: "+420777123456",
      isActive: true,
    },
    select: { id: true },
  });

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: slot.id,
      serviceId: service.id,
      status: BookingStatus.PENDING,
      source: "WEB",
      clientNameSnapshot: `Klientka ${suffix}`,
      clientEmailSnapshot: `client-booking-int-${suffix}@example.com`,
      clientPhoneSnapshot: "+420777123456",
      serviceNameSnapshot: `Služba ${suffix}`,
      serviceDurationMinutes: 60,
      servicePriceFromCzk: 1200,
      scheduledStartsAt: startsAt,
      scheduledEndsAt: endsAt,
    },
    select: { id: true },
  });

  try {
    const result = await applyAdminBookingStatusChange({
      bookingId: booking.id,
      targetStatus: BookingStatus.CONFIRMED,
      actorUserId: owner.id,
      notifyClient: true,
      reason: "Integration confirmation",
      internalNote: "Potvrzeno z integračního testu",
      now: confirmationNow,
    });

    assert.equal(result.status, "success");

    const updatedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: {
        status: true,
        confirmedAt: true,
        internalNote: true,
      },
    });

    assert.ok(updatedBooking);
    assert.equal(updatedBooking.status, BookingStatus.CONFIRMED);
    assert.ok(updatedBooking.confirmedAt);
    assert.equal(updatedBooking.internalNote, "Potvrzeno z integračního testu");

    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: {
        status: true,
        actorType: true,
        actorUserId: true,
        reason: true,
        note: true,
      },
    });

    assert.equal(history.length, 1);
    assert.equal(history[0]?.status, BookingStatus.CONFIRMED);
    assert.equal(history[0]?.actorType, BookingActorType.USER);
    assert.equal(history[0]?.actorUserId, owner.id);
    assert.equal(history[0]?.reason, "Integration confirmation");
    assert.equal(history[0]?.note, "Potvrzeno z integračního testu");

    const actionTokens = await prisma.bookingActionToken.findMany({
      where: { bookingId: booking.id },
      select: { type: true, tokenHash: true },
    });

    assert.equal(actionTokens.length, 4);
    assert.equal(actionTokens.filter((token) => token.type === BookingActionTokenType.RESCHEDULE).length, 2);
    assert.equal(actionTokens.filter((token) => token.type === BookingActionTokenType.CANCEL).length, 2);
    assert.ok(actionTokens.every((token) => token.tokenHash.length > 0));

    const emailLog = await prisma.emailLog.findFirst({
      where: {
        bookingId: booking.id,
        type: EmailLogType.BOOKING_CONFIRMED,
      },
      select: {
        templateKey: true,
        recipientEmail: true,
      },
    });

    assert.ok(emailLog);
    assert.equal(emailLog.templateKey, "booking-approved-v1");
    assert.equal(emailLog.recipientEmail, `client-booking-int-${suffix}@example.com`);
    assert.equal(await prisma.emailLog.count({
      where: {
        bookingId: booking.id,
        type: EmailLogType.BOOKING_REMINDER,
      },
    }), 1);
  } finally {
    await prisma.bookingActionToken.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.emailLog.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.bookingStatusHistory.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.booking.deleteMany({
      where: { id: booking.id },
    });
    await prisma.client.deleteMany({
      where: { id: client.id },
    });
    await prisma.availabilitySlot.deleteMany({
      where: { id: slot.id },
    });
    await prisma.service.deleteMany({
      where: { id: service.id },
    });
    await prisma.serviceCategory.deleteMany({
      where: { id: category.id },
    });
    await prisma.adminUser.deleteMany({
      where: { id: owner.id },
    });
  }
});

dbTest("applyAdminBookingStatusChange serverově odmítne předčasné no-show a po grace period uvolní availability", async () => {
  const [{ prisma }, { applyAdminBookingStatusChange }, { getBookingAvailabilityCatalog }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
    import("@/features/booking/lib/booking-availability-core"),
  ]);
  const suffix = randomUUID().slice(0, 8);
  const { startsAt, endsAt } = await findIsolatedAdminWindow(prisma, suffix, 60);

  const [owner, category, client] = await Promise.all([
    prisma.adminUser.create({ data: { email: `owner-no-show-${suffix}@example.com`, name: `Owner ${suffix}`, role: "OWNER", isActive: true }, select: { id: true } }),
    prisma.serviceCategory.create({ data: { name: `Kategorie no-show ${suffix}`, slug: `kategorie-no-show-${suffix}`, isActive: true }, select: { id: true } }),
    prisma.client.create({ data: { fullName: `Klientka no-show ${suffix}`, email: `client-no-show-${suffix}@example.com`, phone: "+420777123456", isActive: true }, select: { id: true } }),
  ]);
  const service = await prisma.service.create({
    data: { categoryId: category.id, name: `Služba no-show ${suffix}`, slug: `sluzba-no-show-${suffix}`, durationMinutes: 60, priceFromCzk: 1200, isActive: true, isPubliclyBookable: true },
    select: { id: true },
  });
  const slot = await prisma.availabilitySlot.create({
    data: { startsAt, endsAt, status: "PUBLISHED", capacity: 1 },
    select: { id: true },
  });
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id, slotId: slot.id, serviceId: service.id, status: BookingStatus.CONFIRMED, source: "WEB",
      clientNameSnapshot: `Klientka no-show ${suffix}`, clientEmailSnapshot: `client-no-show-${suffix}@example.com`, clientPhoneSnapshot: "+420777123456",
      serviceNameSnapshot: `Služba no-show ${suffix}`, serviceDurationMinutes: 60, servicePriceFromCzk: 1200,
      scheduledStartsAt: startsAt, scheduledEndsAt: endsAt,
    },
    select: { id: true },
  });
  const getAvailability = () => getBookingAvailabilityCatalog({
    includeServices: false,
    bookingWindowStart: startsAt,
    bookingWindowEnd: endsAt,
    availabilitySlotStatus: "PUBLISHED",
    serviceWhere: { id: service.id },
  });

  try {
    const earlyResult = await applyAdminBookingStatusChange({
      bookingId: booking.id, targetStatus: BookingStatus.NO_SHOW, actorUserId: owner.id,
      notifyClient: false,
      now: new Date(startsAt.getTime() - 16 * 60 * 1000),
    });
    assert.equal(earlyResult.status, "no-show-too-early");
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true } })).status, BookingStatus.CONFIRMED);
    assert.equal((await getAvailability()).scheduleOptimization.bookedIntervals.length, 1);

    const noShowAt = new Date(startsAt.getTime() + 15 * 60 * 1000);
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        clientDeliveryLeaseToken: "no-show-worker",
        clientDeliveryLeaseExpiresAt: new Date(noShowAt.getTime() + 60 * 1000),
      },
    });

    const blockedByDeliveryLease = await applyAdminBookingStatusChange({
      bookingId: booking.id, targetStatus: BookingStatus.NO_SHOW, actorUserId: owner.id,
      notifyClient: false,
      now: noShowAt,
    });
    assert.equal(blockedByDeliveryLease.status, "concurrent-modification");
    assert.deepEqual(
      await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { status: true, communicationGeneration: true },
      }),
      { status: BookingStatus.CONFIRMED, communicationGeneration: 1 },
    );

    await prisma.booking.update({
      where: { id: booking.id },
      data: { clientDeliveryLeaseExpiresAt: new Date(0) },
    });

    const validResult = await applyAdminBookingStatusChange({
      bookingId: booking.id, targetStatus: BookingStatus.NO_SHOW, actorUserId: owner.id,
      notifyClient: false,
      now: noShowAt,
    });
    assert.equal(validResult.status, "success");
    assert.deepEqual(
      await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { status: true, communicationGeneration: true },
      }),
      { status: BookingStatus.NO_SHOW, communicationGeneration: 2 },
    );
    assert.equal((await getAvailability()).scheduleOptimization.bookedIntervals.length, 0);
    assert.equal(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id, status: BookingStatus.NO_SHOW } }), 1);
  } finally {
    await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: booking.id } });
    await prisma.booking.deleteMany({ where: { id: booking.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.availabilitySlot.deleteMany({ where: { id: slot.id } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
    await prisma.adminUser.deleteMany({ where: { id: owner.id } });
  }
});

dbTest("applyAdminBookingStatusChange compacts adjacent editable slot fragments on cancellation", async () => {
  const [{ prisma }, { applyAdminBookingStatusChange }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const { startsAt: baseStartAt } = await findIsolatedAdminWindow(prisma, suffix, 120);
  const beforeEndsAt = new Date(baseStartAt.getTime() + 30 * 60 * 1000);
  const bookingEndsAt = new Date(baseStartAt.getTime() + 105 * 60 * 1000);
  const fullEndsAt = new Date(baseStartAt.getTime() + 120 * 60 * 1000);

  const owner = await prisma.adminUser.create({
    data: {
      email: `owner-booking-cancel-${suffix}@example.com`,
      name: `Owner Cancel ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Kategorie cancel ${suffix}`,
      slug: `kategorie-cancel-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Služba cancel ${suffix}`,
      slug: `sluzba-cancel-${suffix}`,
      durationMinutes: 75,
      priceFromCzk: 1200,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true },
  });

  const [, bookedSlot] = await prisma.$transaction([
    prisma.availabilitySlot.create({
      data: {
        startsAt: baseStartAt,
        endsAt: beforeEndsAt,
        status: "PUBLISHED",
        capacity: 1,
        serviceRestrictionMode: "ANY",
        publishedAt: new Date(baseStartAt.getTime() - 24 * 60 * 60 * 1000),
        createdByUserId: owner.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: beforeEndsAt,
        endsAt: bookingEndsAt,
        status: "PUBLISHED",
        capacity: 1,
        serviceRestrictionMode: "ANY",
        publishedAt: new Date(baseStartAt.getTime() - 24 * 60 * 60 * 1000),
        createdByUserId: owner.id,
      },
      select: { id: true },
    }),
    prisma.availabilitySlot.create({
      data: {
        startsAt: bookingEndsAt,
        endsAt: fullEndsAt,
        status: "PUBLISHED",
        capacity: 1,
        serviceRestrictionMode: "ANY",
        publishedAt: new Date(baseStartAt.getTime() - 24 * 60 * 60 * 1000),
        createdByUserId: owner.id,
      },
      select: { id: true },
    }),
  ]);

  const client = await prisma.client.create({
    data: {
      fullName: `Klientka cancel ${suffix}`,
      email: `client-booking-cancel-${suffix}@example.com`,
      phone: "+420777123456",
      isActive: true,
    },
    select: { id: true },
  });

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: bookedSlot.id,
      serviceId: service.id,
      status: BookingStatus.CONFIRMED,
      source: "WEB",
      clientNameSnapshot: `Klientka cancel ${suffix}`,
      clientEmailSnapshot: `client-booking-cancel-${suffix}@example.com`,
      clientPhoneSnapshot: "+420777123456",
      serviceNameSnapshot: `Služba cancel ${suffix}`,
      serviceDurationMinutes: 75,
      servicePriceFromCzk: 1200,
      scheduledStartsAt: beforeEndsAt,
      scheduledEndsAt: bookingEndsAt,
    },
    select: { id: true },
  });

  try {
    await prisma.bookingActionToken.createMany({
      data: [
        {
          bookingId: booking.id,
          type: BookingActionTokenType.CANCEL,
          tokenHash: `admin-cancel-token-${suffix}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        {
          bookingId: booking.id,
          type: BookingActionTokenType.RESCHEDULE,
          tokenHash: `admin-reschedule-token-${suffix}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      ],
    });

    const result = await applyAdminBookingStatusChange({
      bookingId: booking.id,
      targetStatus: BookingStatus.CANCELLED,
      actorUserId: owner.id,
      notifyClient: true,
      reason: "Integration cancellation",
    });

    assert.equal(result.status, "success");

    const updatedBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: {
        status: true,
        slotId: true,
        cancelledAt: true,
      },
    });

    assert.equal(updatedBooking.status, BookingStatus.CANCELLED);
    assert.ok(updatedBooking.cancelledAt);
    assert.equal(updatedBooking.slotId, bookedSlot.id);

    const slots = await prisma.availabilitySlot.findMany({
      where: {
        createdByUserId: owner.id,
      },
      orderBy: {
        startsAt: "asc",
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
      },
    });

    assert.deepEqual(
      slots.map((slot) => ({
        id: slot.id,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      })),
      [{
        id: bookedSlot.id,
        startsAt: baseStartAt.toISOString(),
        endsAt: fullEndsAt.toISOString(),
      }],
    );

    const [emailLogs, actionTokens] = await Promise.all([
      prisma.emailLog.findMany({
        where: {
          bookingId: booking.id,
          type: EmailLogType.BOOKING_CANCELLED,
        },
        select: {
          audience: true,
          recipientEmail: true,
          templateKey: true,
        },
      }),
      prisma.bookingActionToken.findMany({
        where: { bookingId: booking.id },
        select: { revokedAt: true },
      }),
    ]);

    assert.deepEqual(emailLogs, [{
      audience: EmailAudience.CLIENT,
      recipientEmail: `client-booking-cancel-${suffix}@example.com`,
      templateKey: "booking-cancelled-v1",
    }]);
    assert.equal(actionTokens.length, 2);
    assert.ok(actionTokens.every((token) => token.revokedAt));

    const retry = await applyAdminBookingStatusChange({
      bookingId: booking.id,
      targetStatus: BookingStatus.CANCELLED,
      actorUserId: owner.id,
      notifyClient: true,
    });
    assert.equal(retry.status, "invalid-transition");
    assert.equal(
      await prisma.emailLog.count({
        where: {
          bookingId: booking.id,
          type: EmailLogType.BOOKING_CANCELLED,
          audience: EmailAudience.CLIENT,
        },
      }),
      1,
    );
  } finally {
    await prisma.bookingActionToken.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.emailLog.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.bookingStatusHistory.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.booking.deleteMany({
      where: { id: booking.id },
    });
    await prisma.client.deleteMany({
      where: { id: client.id },
    });
    await prisma.availabilitySlot.deleteMany({
      where: { createdByUserId: owner.id },
    });
    await prisma.service.deleteMany({
      where: { id: service.id },
    });
    await prisma.serviceCategory.deleteMany({
      where: { id: category.id },
    });
    await prisma.adminUser.deleteMany({
      where: { id: owner.id },
    });
  }
});

dbTest("admin cancellation with notifyClient=false does not create a client email log", async () => {
  const [{ prisma }, { applyAdminBookingStatusChange }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const fixture = await createAdminCancellationFixture(
    prisma,
    randomUUID().slice(0, 8),
    "client-without-notification@example.com",
  );

  try {
    const result = await applyAdminBookingStatusChange({
      bookingId: fixture.booking.id,
      targetStatus: BookingStatus.CANCELLED,
      actorUserId: fixture.owner.id,
      notifyClient: false,
    });

    assert.equal(result.status, "success");
    assert.equal(
      await prisma.emailLog.count({
        where: {
          bookingId: fixture.booking.id,
          type: EmailLogType.BOOKING_CANCELLED,
          audience: EmailAudience.CLIENT,
        },
      }),
      0,
    );
  } finally {
    await fixture.cleanup();
  }
});

dbTest("admin cancellation posílá CLIENT e-mail na snapshot rezervace, ne na master kontakt", async () => {
  const [{ prisma }, { applyAdminBookingStatusChange }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createAdminCancellationFixture(
    prisma,
    suffix,
    `master-cancellation-${suffix}@example.com`,
    `booking-cancellation-${suffix}@example.com`,
  );

  try {
    const result = await applyAdminBookingStatusChange({
      bookingId: fixture.booking.id,
      targetStatus: BookingStatus.CANCELLED,
      actorUserId: fixture.owner.id,
      notifyClient: true,
    });

    assert.equal(result.status, "success");
    const emailLog = await prisma.emailLog.findFirstOrThrow({
      where: {
        bookingId: fixture.booking.id,
        type: EmailLogType.BOOKING_CANCELLED,
        audience: EmailAudience.CLIENT,
      },
      select: { recipientEmail: true },
    });
    assert.equal(emailLog.recipientEmail, `booking-cancellation-${suffix}@example.com`);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("admin cancellation without a client email succeeds without a client email log", async () => {
  const [{ prisma }, { applyAdminBookingStatusChange }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const fixture = await createAdminCancellationFixture(
    prisma,
    randomUUID().slice(0, 8),
    null,
  );

  try {
    const result = await applyAdminBookingStatusChange({
      bookingId: fixture.booking.id,
      targetStatus: BookingStatus.CANCELLED,
      actorUserId: fixture.owner.id,
      notifyClient: true,
    });

    assert.equal(result.status, "success");
    assert.equal(
      await prisma.emailLog.count({
        where: {
          bookingId: fixture.booking.id,
          type: EmailLogType.BOOKING_CANCELLED,
          audience: EmailAudience.CLIENT,
        },
      }),
      0,
    );
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({
        where: { id: fixture.booking.id },
        select: { status: true },
      })).status,
      BookingStatus.CANCELLED,
    );
  } finally {
    await fixture.cleanup();
  }
});

dbTest("applyAdminBookingStatusChange archives only its orphaned manual-override DRAFT slot", async () => {
  const [{ prisma }, { applyAdminBookingStatusChange }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const { startsAt, endsAt } = await findIsolatedAdminWindow(prisma, suffix, 60);
  const owner = await prisma.adminUser.create({
    data: { email: `owner-override-cancel-${suffix}@example.com`, name: `Owner ${suffix}`, role: "OWNER", isActive: true },
    select: { id: true },
  });
  const category = await prisma.serviceCategory.create({
    data: { name: `Kategorie override ${suffix}`, slug: `kategorie-override-${suffix}`, isActive: true },
    select: { id: true },
  });
  const service = await prisma.service.create({
    data: {
      categoryId: category.id, name: `Služba override ${suffix}`, slug: `sluzba-override-${suffix}`,
      durationMinutes: 60, priceFromCzk: 1200, isActive: true, isPubliclyBookable: true,
    },
    select: { id: true },
  });
  const client = await prisma.client.create({
    data: { fullName: `Klientka override ${suffix}`, email: `override-${suffix}@example.com`, phone: "+420777123456", isActive: true },
    select: { id: true },
  });
  const manualOverrideSlot = await prisma.availabilitySlot.create({
    data: {
      startsAt, endsAt, capacity: 1, status: "DRAFT", serviceRestrictionMode: "ANY",
      internalNote: "Dočasná ruční výjimka", createdByUserId: owner.id,
    },
    select: { id: true },
  });
  const archivedOriginalSlot = await prisma.availabilitySlot.create({
    data: {
      startsAt, endsAt, capacity: 1, status: "ARCHIVED", serviceRestrictionMode: "ANY",
      createdByUserId: owner.id,
    },
    select: { id: true },
  });
  const adminDraftSlot = await prisma.availabilitySlot.create({
    data: {
      startsAt: new Date(endsAt.getTime() + 60 * 60 * 1000),
      endsAt: new Date(endsAt.getTime() + 2 * 60 * 60 * 1000),
      capacity: 1, status: "DRAFT", serviceRestrictionMode: "ANY",
      internalNote: "Skutečná administrativní blokace", createdByUserId: owner.id,
    },
    select: { id: true },
  });
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id, slotId: manualOverrideSlot.id, serviceId: service.id,
      status: BookingStatus.CONFIRMED, source: "PHONE", manualOverride: true,
      clientNameSnapshot: `Klientka override ${suffix}`, clientEmailSnapshot: `override-${suffix}@example.com`,
      clientPhoneSnapshot: "+420777123456", serviceNameSnapshot: `Služba override ${suffix}`,
      serviceDurationMinutes: 60, servicePriceFromCzk: 1200, scheduledStartsAt: startsAt, scheduledEndsAt: endsAt,
    },
    select: { id: true },
  });

  try {
    const result = await applyAdminBookingStatusChange({
      bookingId: booking.id,
      targetStatus: BookingStatus.CANCELLED,
      actorUserId: owner.id,
      notifyClient: true,
      reason: "Integration manual override cancellation",
    });

    assert.equal(result.status, "success");
    const [updatedBooking, manualOverrideSlotAfterCancellation, archivedOriginalSlotAfterCancellation, adminDraftSlotAfterCancellation] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true } }),
      prisma.availabilitySlot.findUniqueOrThrow({ where: { id: manualOverrideSlot.id }, select: { status: true } }),
      prisma.availabilitySlot.findUniqueOrThrow({ where: { id: archivedOriginalSlot.id }, select: { status: true } }),
      prisma.availabilitySlot.findUniqueOrThrow({ where: { id: adminDraftSlot.id }, select: { status: true } }),
    ]);

    assert.equal(updatedBooking.status, BookingStatus.CANCELLED);
    assert.equal(manualOverrideSlotAfterCancellation.status, "ARCHIVED");
    assert.equal(archivedOriginalSlotAfterCancellation.status, "PUBLISHED");
    assert.equal(adminDraftSlotAfterCancellation.status, "DRAFT");
  } finally {
    await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: booking.id } });
    await prisma.booking.deleteMany({ where: { id: booking.id } });
    await prisma.client.deleteMany({ where: { id: client.id } });
    await prisma.availabilitySlot.deleteMany({ where: { id: { in: [manualOverrideSlot.id, archivedOriginalSlot.id, adminDraftSlot.id] } } });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
    await prisma.adminUser.deleteMany({ where: { id: owner.id } });
  }
});

dbTest("updateAdminBookingService rewrites booking snapshot and audit history", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const { startsAt, endsAt } = await findIsolatedAdminWindow(prisma, suffix, 60);
  const expectedServiceEndsAt = new Date(startsAt.getTime() + 45 * 60 * 1000);

  const owner = await prisma.adminUser.create({
    data: {
      email: `owner-booking-service-${suffix}@example.com`,
      name: `Owner Service ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });

  const category = await prisma.serviceCategory.create({
    data: {
      name: `Kategorie služby ${suffix}`,
      slug: `kategorie-sluzby-${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });

  const [originalService, replacementService] = await Promise.all([
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Původní služba ${suffix}`,
        slug: `puvodni-sluzba-${suffix}`,
        durationMinutes: 60,
        priceFromCzk: 1200,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
    prisma.service.create({
      data: {
        categoryId: category.id,
        name: `Nová služba ${suffix}`,
        slug: `nova-sluzba-${suffix}`,
        durationMinutes: 45,
        cleanupMinutes: 10,
        priceFromCzk: 1500,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: { id: true },
    }),
  ]);

  const slot = await prisma.availabilitySlot.create({
    data: {
      startsAt,
      endsAt,
      status: "PUBLISHED",
      capacity: 1,
      serviceRestrictionMode: "ANY",
    },
    select: { id: true },
  });

  const client = await prisma.client.create({
    data: {
      fullName: `Klientka změny služby ${suffix}`,
      email: `client-booking-service-${suffix}@example.com`,
      phone: "+420777123456",
      isActive: true,
    },
    select: { id: true },
  });

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      slotId: slot.id,
      serviceId: originalService.id,
      status: BookingStatus.CONFIRMED,
      source: "WEB",
      clientNameSnapshot: `Klientka změny služby ${suffix}`,
      clientEmailSnapshot: `client-booking-service-${suffix}@example.com`,
      clientPhoneSnapshot: "+420777123456",
      serviceNameSnapshot: `Původní služba ${suffix}`,
      serviceDurationMinutes: 60,
      servicePriceFromCzk: 1200,
      scheduledStartsAt: startsAt,
      scheduledEndsAt: endsAt,
      blockedUntil: endsAt,
    },
    select: { id: true, updatedAt: true },
  });

  try {
    const result = await updateAdminBookingService({
      bookingId: booking.id,
      serviceId: replacementService.id,
      actorUserId: owner.id,
      expectedUpdatedAt: booking.updatedAt.toISOString(),
      reason: "Klientka si na místě zvolila jinou péči",
    });

    assert.equal(result.status, "success");

    const updatedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: {
        manualOverride: true,
        serviceId: true,
        serviceNameSnapshot: true,
        serviceDurationMinutes: true,
        cleanupMinutes: true,
        cleanupBlockMinutes: true,
        servicePriceFromCzk: true,
        scheduledEndsAt: true,
        blockedUntil: true,
        reminder24hQueuedAt: true,
        reminder24hSentAt: true,
      },
    });

    assert.ok(updatedBooking);
    assert.equal(updatedBooking.manualOverride, false);
    assert.equal(updatedBooking.serviceId, replacementService.id);
    assert.equal(updatedBooking.serviceNameSnapshot, `Nová služba ${suffix}`);
    assert.equal(updatedBooking.serviceDurationMinutes, 45);
    assert.equal(updatedBooking.cleanupMinutes, 10);
    assert.equal(updatedBooking.cleanupBlockMinutes, 15);
    assert.equal(updatedBooking.servicePriceFromCzk, 1500);
    assert.equal(updatedBooking.scheduledEndsAt.toISOString(), expectedServiceEndsAt.toISOString());
    assert.equal(updatedBooking.blockedUntil?.toISOString(), endsAt.toISOString());
    assert.equal(updatedBooking.reminder24hQueuedAt, null);
    assert.equal(updatedBooking.reminder24hSentAt, null);

    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: {
        status: true,
        actorType: true,
        actorUserId: true,
        reason: true,
        metadata: true,
      },
    });

    assert.equal(history.length, 1);
    assert.equal(history[0]?.status, BookingStatus.CONFIRMED);
    assert.equal(history[0]?.actorType, BookingActorType.USER);
    assert.equal(history[0]?.actorUserId, owner.id);
    assert.match(history[0]?.reason ?? "", /Klientka si na místě zvolila jinou péči/);

    const metadata = history[0]?.metadata as Record<string, unknown> | null;
    assert.equal(metadata?.source, "admin-booking-service-change-v1");
    assert.equal(metadata?.previousServiceId, originalService.id);
    assert.equal(metadata?.nextServiceId, replacementService.id);
  } finally {
    await prisma.bookingStatusHistory.deleteMany({
      where: { bookingId: booking.id },
    });
    await prisma.booking.deleteMany({
      where: { id: booking.id },
    });
    await prisma.client.deleteMany({
      where: { id: client.id },
    });
    await prisma.availabilitySlot.deleteMany({
      where: { id: slot.id },
    });
    await prisma.service.deleteMany({
      where: { id: { in: [originalService.id, replacementService.id] } },
    });
    await prisma.serviceCategory.deleteMany({
      where: { id: category.id },
    });
    await prisma.adminUser.deleteMany({
      where: { id: owner.id },
    });
  }
});

dbTest("updateAdminBookingService resetuje neodeslaný reminder a scheduler založí reminder pro novou službu", async () => {
  const [{ prisma }, { updateAdminBookingService }, { runBookingReminderSchedulerOnce }, { claimEmailLogForImmediateDelivery, deliverEmailLog }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
    import("@/lib/email/worker"),
    import("@/lib/email/delivery"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createAdminServiceChangeFixture(prisma, suffix, { isolateReminderScan: true });
  const queuedAt = new Date(fixture.startsAt.getTime() - 26 * 60 * 60 * 1000);
  const oldReminder = await prisma.emailLog.create({
    data: {
      bookingId: fixture.booking.id,
      type: EmailLogType.BOOKING_REMINDER,
      audience: EmailAudience.CLIENT,
      status: EmailLogStatus.PENDING,
      recipientEmail: `client-service-change-${suffix}@example.com`,
      subject: "Zítra se na vás těšíme v PP Studiu",
      templateKey: "booking-reminder-24h-v1",
      payload: {
        bookingId: fixture.booking.id,
        serviceId: fixture.originalService.id,
        serviceName: `Původní změna služby ${suffix}`,
        clientName: `Klientka změny služby ${suffix}`,
        scheduledStartsAt: fixture.startsAt.toISOString(),
        scheduledEndsAt: fixture.bookingEndsAt.toISOString(),
      },
      nextAttemptAt: new Date(0),
    },
    select: { id: true },
  });

  try {
    const queuedBooking = await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: { reminder24hQueuedAt: queuedAt, reminder24hSentAt: null },
      select: { updatedAt: true },
    });
    const result = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.replacementService.id,
      actorUserId: fixture.owner.id,
      expectedUpdatedAt: queuedBooking.updatedAt.toISOString(),
    });

    assert.equal(result.status, "success");

    const afterChange = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.booking.id },
      select: { serviceId: true, reminder24hQueuedAt: true, reminder24hSentAt: true },
    });
    assert.equal(afterChange.serviceId, fixture.replacementService.id);
    assert.equal(afterChange.reminder24hQueuedAt, null);
    assert.equal(afterChange.reminder24hSentAt, null);

    const oldClaim = await claimEmailLogForImmediateDelivery(oldReminder.id);
    assert.ok(oldClaim);
    assert.deepEqual(await deliverEmailLog(oldReminder.id, oldClaim), {
      status: "skipped",
      errorMessage: "Booking service no longer matches the email.",
    });
    const skippedOldReminder = await prisma.emailLog.findUniqueOrThrow({
      where: { id: oldReminder.id },
      select: { status: true, provider: true },
    });
    assert.equal(skippedOldReminder.status, EmailLogStatus.SENT);
    assert.equal(skippedOldReminder.provider, "system-skip");

    const schedulerResult = await runBookingReminderSchedulerOnce(
      new Date(fixture.startsAt.getTime() - (25.5 * 60 * 60 * 1000)),
    );
    assert.deepEqual(schedulerResult, { foundBookings: 1, enqueued: 1, failed: 0 });

    const reminderLogs = await prisma.emailLog.findMany({
      where: { bookingId: fixture.booking.id, type: EmailLogType.BOOKING_REMINDER },
      orderBy: { createdAt: "asc" },
      select: { id: true, payload: true, provider: true },
    });
    assert.equal(reminderLogs.length, 2);
    const newReminder = reminderLogs.find((log) => log.id !== oldReminder.id);
    assert.ok(newReminder);
    assert.equal((newReminder.payload as Record<string, unknown>).serviceId, fixture.replacementService.id);
    assert.equal(newReminder.provider, "log");

    const finalBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.booking.id },
      select: { reminder24hQueuedAt: true, reminder24hSentAt: true },
    });
    assert.ok(finalBooking.reminder24hQueuedAt);
    assert.ok(finalBooking.reminder24hSentAt);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("updateAdminBookingService po opuštění enqueue window vytvoří replacement reminder pro novou službu", async () => {
  const [{ prisma }, { updateAdminBookingService }, { claimEmailLogForImmediateDelivery, deliverEmailLog }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
    import("@/lib/email/delivery"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createAdminServiceChangeFixture(prisma, suffix);
  const now = new Date(fixture.startsAt.getTime() - 24.5 * 60 * 60 * 1000);
  const oldReminder = await prisma.emailLog.create({
    data: {
      bookingId: fixture.booking.id,
      type: EmailLogType.BOOKING_REMINDER,
      audience: EmailAudience.CLIENT,
      status: EmailLogStatus.PENDING,
      recipientEmail: `client-service-change-${suffix}@example.com`,
      subject: "Zítra se na vás těšíme v PP Studiu",
      templateKey: "booking-reminder-24h-v1",
      payload: {
        bookingId: fixture.booking.id,
        serviceId: fixture.originalService.id,
        serviceName: `Původní změna služby ${suffix}`,
        clientName: `Klientka změny služby ${suffix}`,
        scheduledStartsAt: fixture.startsAt.toISOString(),
        scheduledEndsAt: fixture.bookingEndsAt.toISOString(),
      },
      nextAttemptAt: new Date(0),
    },
    select: { id: true },
  });

  try {
    const queuedBooking = await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: {
        reminder24hQueuedAt: new Date(now.getTime() - 60 * 60 * 1000),
        reminder24hSentAt: null,
      },
      select: { updatedAt: true },
    });
    const result = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.replacementService.id,
      actorUserId: fixture.owner.id,
      expectedUpdatedAt: queuedBooking.updatedAt.toISOString(),
      now,
    });

    assert.equal(result.status, "success");

    const oldClaim = await claimEmailLogForImmediateDelivery(oldReminder.id);
    assert.ok(oldClaim);
    assert.deepEqual(await deliverEmailLog(oldReminder.id, oldClaim), {
      status: "skipped",
      errorMessage: "Booking service no longer matches the email.",
    });

    const reminderLogs = await prisma.emailLog.findMany({
      where: { bookingId: fixture.booking.id, type: EmailLogType.BOOKING_REMINDER },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, payload: true },
    });
    assert.equal(reminderLogs.length, 2);
    const replacement = reminderLogs.find((log) => log.id !== oldReminder.id);
    assert.ok(replacement);
    assert.equal(replacement.status, EmailLogStatus.SENT);
    assert.equal((replacement.payload as Record<string, unknown>).serviceId, fixture.replacementService.id);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("updateAdminBookingService uvnitř enqueue window založí reminder okamžitě", async () => {
  const [{ prisma }, { updateAdminBookingService }, { runBookingReminderSchedulerOnce }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
    import("@/lib/email/worker"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createAdminServiceChangeFixture(prisma, suffix, { isolateReminderScan: true });
  const now = new Date(fixture.startsAt.getTime() - 25.5 * 60 * 60 * 1000);

  try {
    const result = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.replacementService.id,
      actorUserId: fixture.owner.id,
      expectedUpdatedAt: fixture.booking.updatedAt.toISOString(),
      now,
    });

    assert.equal(result.status, "success");
    assert.equal(
      await prisma.emailLog.count({
        where: { bookingId: fixture.booking.id, type: EmailLogType.BOOKING_REMINDER },
      }),
      1,
    );

    const schedulerResult = await runBookingReminderSchedulerOnce(now);
    assert.deepEqual(schedulerResult, { foundBookings: 0, enqueued: 0, failed: 0 });

    const reminder = await prisma.emailLog.findFirstOrThrow({
      where: { bookingId: fixture.booking.id, type: EmailLogType.BOOKING_REMINDER },
      select: { payload: true },
    });
    assert.equal((reminder.payload as Record<string, unknown>).serviceId, fixture.replacementService.id);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("enqueue helper nereplikuje aktuální PENDING reminder", async () => {
  const [{ prisma }, { enqueueBookingReminder24hForBooking }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/features/booking/lib/booking-reminders"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createAdminServiceChangeFixture(prisma, suffix);
  const now = new Date(fixture.startsAt.getTime() - 60 * 60 * 1000);
  await prisma.emailLog.create({
    data: {
      bookingId: fixture.booking.id,
      clientId: fixture.client.id,
      type: EmailLogType.BOOKING_REMINDER,
      audience: EmailAudience.CLIENT,
      status: EmailLogStatus.PENDING,
      recipientEmail: `client-service-change-${suffix}@example.com`,
      subject: "Zítra se na vás těšíme v PP Studiu",
      templateKey: "booking-reminder-24h-v1",
      payload: {
        bookingId: fixture.booking.id,
        serviceId: fixture.originalService.id,
        scheduledStartsAt: fixture.startsAt.toISOString(),
        scheduledEndsAt: fixture.bookingEndsAt.toISOString(),
      },
      nextAttemptAt: now,
    },
  });

  try {
    const result = await prisma.$transaction((tx) => enqueueBookingReminder24hForBooking(tx, {
      id: fixture.booking.id,
      clientId: fixture.client.id,
      clientEmailSnapshot: `client-service-change-${suffix}@example.com`,
      communicationGeneration: 1,
      clientNameSnapshot: `Klientka změny služby ${suffix}`,
      status: BookingStatus.CONFIRMED,
      serviceId: fixture.originalService.id,
      serviceNameSnapshot: `Původní změna služby ${suffix}`,
      scheduledStartsAt: fixture.startsAt,
      scheduledEndsAt: fixture.bookingEndsAt,
    }, now));

    assert.deepEqual(result, {
      created: false,
      reason: "Current booking reminder is already pending.",
    });
    assert.equal(
      await prisma.emailLog.count({
        where: { bookingId: fixture.booking.id, type: EmailLogType.BOOKING_REMINDER },
      }),
      1,
    );
  } finally {
    await fixture.cleanup();
  }
});

dbTest("updateAdminBookingService po začátku rezervace replacement reminder nevytvoří", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createAdminServiceChangeFixture(prisma, suffix);
  const now = new Date(fixture.startsAt.getTime() + 60 * 60 * 1000);

  try {
    const result = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.replacementService.id,
      actorUserId: fixture.owner.id,
      expectedUpdatedAt: fixture.booking.updatedAt.toISOString(),
      now,
    });

    assert.equal(result.status, "success");
    assert.equal(
      await prisma.emailLog.count({
        where: { bookingId: fixture.booking.id, type: EmailLogType.BOOKING_REMINDER },
      }),
      0,
    );
  } finally {
    await fixture.cleanup();
  }
});

dbTest("updateAdminBookingService nemění stav již odeslaného reminderu", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createAdminServiceChangeFixture(prisma, suffix);
  const queuedAt = new Date(fixture.startsAt.getTime() - 26 * 60 * 60 * 1000);
  const sentAt = new Date(fixture.startsAt.getTime() - 25 * 60 * 60 * 1000);

  try {
    const preparedBooking = await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: { reminder24hQueuedAt: queuedAt, reminder24hSentAt: sentAt },
      select: { updatedAt: true },
    });
    const result = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.replacementService.id,
      actorUserId: fixture.owner.id,
      expectedUpdatedAt: preparedBooking.updatedAt.toISOString(),
    });

    assert.equal(result.status, "success");
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.booking.id },
      select: { reminder24hQueuedAt: true, reminder24hSentAt: true },
    });
    assert.equal(booking.reminder24hQueuedAt?.toISOString(), queuedAt.toISOString());
    assert.equal(booking.reminder24hSentAt?.toISOString(), sentAt.toISOString());
  } finally {
    await fixture.cleanup();
  }
});

dbTest("rollback změny služby vrátí i reset neodeslaného reminderu", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createAdminServiceChangeFixture(prisma, suffix);
  const queuedAt = new Date(fixture.startsAt.getTime() - 26 * 60 * 60 * 1000);

  try {
    const preparedBooking = await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: { reminder24hQueuedAt: queuedAt, reminder24hSentAt: null },
      select: { updatedAt: true },
    });

    const originalTransaction = prisma.$transaction;
    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        const operation = args[0] as (transaction: Prisma.TransactionClient) => Promise<unknown>;
        return Reflect.apply(originalTransaction, prisma, [
          async (transaction: Prisma.TransactionClient) => {
            await operation(transaction);
            throw new Error("forced service change rollback");
          },
          args[1],
        ]);
      },
    });

    try {
      await assert.rejects(
        updateAdminBookingService({
          bookingId: fixture.booking.id,
          serviceId: fixture.replacementService.id,
          actorUserId: fixture.owner.id,
          expectedUpdatedAt: preparedBooking.updatedAt.toISOString(),
        }),
        /forced service change rollback/,
      );
    } finally {
      Object.defineProperty(prisma, "$transaction", {
        configurable: true,
        writable: true,
        value: originalTransaction,
      });
    }

    assert.equal(typeof prisma.$transaction, "function");

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.booking.id },
      select: { serviceId: true, reminder24hQueuedAt: true, reminder24hSentAt: true },
    });
    assert.equal(booking.serviceId, fixture.originalService.id);
    assert.equal(booking.reminder24hQueuedAt?.toISOString(), queuedAt.toISOString());
    assert.equal(booking.reminder24hSentAt, null);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("updateAdminBookingService authoritativeně chrání automatický oběd", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const scenarios = [
    {
      name: "prodloužení se zachovaným obědem",
      originalDurationMinutes: 60,
      replacementDurationMinutes: 90,
      activeAutoLunch: true,
      expectedStatus: "success",
    },
    {
      name: "prodloužení odstraňující poslední oběd",
      originalDurationMinutes: 90,
      replacementDurationMinutes: 105,
      activeAutoLunch: true,
      expectedStatus: "slot-unavailable",
    },
    {
      name: "zkrácení služby",
      originalDurationMinutes: 105,
      replacementDurationMinutes: 60,
      activeAutoLunch: true,
      expectedStatus: "success",
    },
    {
      name: "den bez aktivního auto-lunch",
      originalDurationMinutes: 90,
      replacementDurationMinutes: 105,
      activeAutoLunch: false,
      expectedStatus: "success",
    },
  ] as const;

  for (const scenario of scenarios) {
    const fixture = await createAdminAutoLunchServiceChangeFixture(
      prisma,
      randomUUID().slice(0, 8),
      scenario,
    );

    try {
      const result = await updateAdminBookingService({
        bookingId: fixture.booking.id,
        serviceId: fixture.replacementService.id,
        actorUserId: fixture.owner.id,
        expectedUpdatedAt: fixture.booking.updatedAt.toISOString(),
      });

      assert.equal(result.status, scenario.expectedStatus, `Scénář ${scenario.name} má mít očekávaný výsledek.`);

      if (scenario.expectedStatus === "slot-unavailable") {
        const unchangedBooking = await prisma.booking.findUniqueOrThrow({
          where: { id: fixture.booking.id },
          select: { serviceId: true, scheduledEndsAt: true, blockedUntil: true },
        });
        assert.equal(unchangedBooking.serviceId, fixture.originalService.id);
        assert.equal(unchangedBooking.scheduledEndsAt.toISOString(), fixture.bookingEndsAt.toISOString());
        assert.equal(unchangedBooking.blockedUntil?.toISOString(), fixture.bookingEndsAt.toISOString());
      }
    } finally {
      await fixture.cleanup();
    }
  }
});

dbTest("updateAdminBookingService rozlišuje coverage služby, stale slot a skutečný manual override", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const scenarios = [
    "cleanup-overhang",
    "insufficient-coverage",
    "coverage-gap",
    "archived-slot-with-current-coverage",
    "archived-slot-without-current-coverage",
    "manual-override",
  ] as const;

  for (const scenario of scenarios) {
    const fixture = await createAdminServiceChangeFixture(prisma, randomUUID().slice(0, 8));

    try {
      switch (scenario) {
        case "cleanup-overhang":
          await Promise.all([
            prisma.service.update({
              where: { id: fixture.replacementService.id },
              data: { durationMinutes: 60, cleanupMinutes: 10 },
            }),
            prisma.availabilitySlot.update({
              where: { id: fixture.slot.id },
              data: { endsAt: fixture.bookingEndsAt },
            }),
          ]);
          break;
        case "insufficient-coverage":
          await prisma.availabilitySlot.update({
            where: { id: fixture.slot.id },
            data: { endsAt: fixture.bookingEndsAt },
          });
          break;
        case "coverage-gap":
          await Promise.all([
            prisma.service.update({
              where: { id: fixture.replacementService.id },
              data: { durationMinutes: 60 },
            }),
            prisma.availabilitySlot.update({
              where: { id: fixture.slot.id },
              data: { endsAt: new Date(fixture.startsAt.getTime() + 30 * 60 * 1000) },
            }),
          ]);
          await prisma.availabilitySlot.create({
            data: {
              startsAt: new Date(fixture.startsAt.getTime() + 45 * 60 * 1000),
              endsAt: fixture.bookingEndsAt,
              status: "PUBLISHED",
              capacity: 1,
              serviceRestrictionMode: "ANY",
            },
          });
          break;
        case "archived-slot-with-current-coverage":
          await prisma.availabilitySlot.update({
            where: { id: fixture.slot.id },
            data: { status: "ARCHIVED" },
          });
          await prisma.availabilitySlot.create({
            data: {
              startsAt: fixture.startsAt,
              endsAt: fixture.endsAt,
              status: "PUBLISHED",
              capacity: 1,
              serviceRestrictionMode: "ANY",
            },
          });
          break;
        case "archived-slot-without-current-coverage":
          await prisma.availabilitySlot.update({
            where: { id: fixture.slot.id },
            data: { status: "ARCHIVED" },
          });
          break;
        case "manual-override":
          await Promise.all([
            prisma.booking.update({
              where: { id: fixture.booking.id },
              data: { manualOverride: true },
            }),
            prisma.availabilitySlot.update({
              where: { id: fixture.slot.id },
              data: { status: "DRAFT" },
            }),
          ]);
          break;
      }

      const result = await updateAdminBookingService({
        bookingId: fixture.booking.id,
        serviceId: fixture.replacementService.id,
        actorUserId: fixture.owner.id,
      });

      const shouldSucceed = scenario === "cleanup-overhang"
        || scenario === "archived-slot-with-current-coverage"
        || scenario === "manual-override";
      assert.equal(
        result.status,
        shouldSucceed ? "success" : "slot-too-short",
        `Scénář ${scenario} musí ${shouldSucceed ? "projít" : "selhat na coverage"}.`,
      );
    } finally {
      await fixture.cleanup();
    }
  }
});

dbTest("updateAdminBookingService odmítne globální kolizi mimo původní slot", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const fixture = await createAdminServiceChangeFixture(prisma, randomUUID().slice(0, 8));
  const conflictingWindow = await findIsolatedAdminWindow(prisma, randomUUID().slice(0, 8), 60);
  // Slot nesmí kolidovat s původním slotem kvůli DB exclusion constraintě;
  // samotný booking záměrně používá čas překrývající nový termín rezervace.
  const conflictingSlot = await prisma.availabilitySlot.create({
    data: {
      startsAt: conflictingWindow.startsAt,
      endsAt: conflictingWindow.endsAt,
      status: "PUBLISHED",
      capacity: 1,
      serviceRestrictionMode: "ANY",
      publishedAt: new Date(conflictingWindow.startsAt.getTime() - 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const conflictingClient = await prisma.client.create({
    data: {
      fullName: `Kolizní klientka ${fixture.booking.id}`,
      email: `conflict-service-change-${fixture.booking.id}@example.com`,
      phone: "+420777123457",
      isActive: true,
    },
    select: { id: true },
  });

  try {
    await prisma.booking.create({
      data: {
        clientId: conflictingClient.id,
        slotId: conflictingSlot.id,
        serviceId: fixture.originalService.id,
        status: BookingStatus.CONFIRMED,
        source: "WEB",
        clientNameSnapshot: "Kolizní klientka",
        clientEmailSnapshot: `conflict-service-change-${fixture.booking.id}@example.com`,
        serviceNameSnapshot: "Kolizní služba",
        serviceDurationMinutes: 60,
        servicePriceFromCzk: 1200,
        scheduledStartsAt: fixture.bookingEndsAt,
        scheduledEndsAt: fixture.endsAt,
        blockedUntil: fixture.endsAt,
      },
    });

    const result = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.replacementService.id,
      actorUserId: fixture.owner.id,
      expectedUpdatedAt: fixture.booking.updatedAt.toISOString(),
    });

    assert.equal(result.status, "conflict");
  } finally {
    await fixture.cleanup();
    await prisma.availabilitySlot.deleteMany({ where: { id: conflictingSlot.id } });
    await prisma.client.deleteMany({ where: { id: conflictingClient.id } });
  }
});

dbTest("souběh změny služby a nové rezervace nikdy neuloží překrytí", async () => {
  const [{ prisma }, { updateAdminBookingService }, { createManualBooking, PublicBookingError, publicBookingErrorCodes }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
    import("@/features/booking/lib/booking-public"),
  ]);
  const fixture = await createAdminServiceChangeFixture(prisma, randomUUID().slice(0, 8));

  try {
    const [serviceChange, newBooking] = await Promise.allSettled([
      updateAdminBookingService({
        bookingId: fixture.booking.id,
        serviceId: fixture.replacementService.id,
        actorUserId: fixture.owner.id,
        expectedUpdatedAt: fixture.booking.updatedAt.toISOString(),
      }),
      createManualBooking({
        serviceId: fixture.originalService.id,
        slotId: fixture.slot.id,
        allowManualOverride: false,
        startsAt: fixture.bookingEndsAt.toISOString(),
        fullName: `Souběžná klientka ${fixture.booking.id}`,
        email: `concurrent-service-change-${fixture.booking.id}@example.com`,
        phone: "+420777123458",
        source: BookingSource.PHONE,
        status: BookingStatus.CONFIRMED,
        actorUserId: fixture.owner.id,
        sendClientEmail: false,
        includeCalendarAttachment: false,
      }),
    ]);

    assert.equal(serviceChange.status, "fulfilled");
    if (serviceChange.status !== "fulfilled") return;

    if (serviceChange.value.status === "success") {
      assert.equal(newBooking.status, "rejected");
      if (newBooking.status === "rejected") {
        assert.ok(newBooking.reason instanceof PublicBookingError);
        assert.equal(newBooking.reason.code, publicBookingErrorCodes.slotUnavailable);
      }
    } else {
      assert.equal(serviceChange.value.status, "conflict");
      assert.equal(newBooking.status, "fulfilled");
    }

    const activeBookings = await prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        scheduledStartsAt: { gte: fixture.startsAt, lt: fixture.endsAt },
      },
      select: {
        id: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        blockedUntil: true,
      },
    });

    for (const [index, booking] of activeBookings.entries()) {
      for (const other of activeBookings.slice(index + 1)) {
        const bookingBlockedUntil = booking.blockedUntil ?? booking.scheduledEndsAt;
        const otherBlockedUntil = other.blockedUntil ?? other.scheduledEndsAt;
        assert.ok(
          booking.scheduledStartsAt >= otherBlockedUntil || other.scheduledStartsAt >= bookingBlockedUntil,
          `Aktivní bookingy ${booking.id} a ${other.id} se nesmí překrývat.`,
        );
      }
    }
  } finally {
    await fixture.cleanup();
  }
});

dbTest("změna služby zkrátí manual DRAFT a obnoví původní PUBLISHED dostupnost", async () => {
  const [{ prisma }, { updateAdminBookingService, applyAdminBookingStatusChange }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const fixture = await createAdminManualOverrideResizeFixture(prisma, randomUUID().slice(0, 8));

  try {
    const shortening = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.shortService.id,
      actorUserId: fixture.owner.id,
      expectedUpdatedAt: fixture.booking.updatedAt.toISOString(),
    });

    assert.equal(shortening.status, "success");
    const shortenedSlots = await prisma.availabilitySlot.findMany({
      where: {
        status: { in: [AvailabilitySlotStatus.DRAFT, AvailabilitySlotStatus.PUBLISHED] },
        startsAt: { lt: fixture.originalAvailabilityEndsAt },
        endsAt: { gt: fixture.manualStartsAt },
      },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true, endsAt: true, status: true },
    });
    assert.deepEqual(shortenedSlots.map((slot) => [slot.startsAt, slot.endsAt, slot.status]), [
      [fixture.manualStartsAt, new Date(fixture.manualStartsAt.getTime() + 30 * 60 * 1000), AvailabilitySlotStatus.DRAFT],
      [fixture.originalAvailabilityStartsAt, fixture.originalAvailabilityEndsAt, AvailabilitySlotStatus.PUBLISHED],
    ]);

    const extension = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.longService.id,
      actorUserId: fixture.owner.id,
    });

    assert.equal(extension.status, "success");
    const extendedSlots = await prisma.availabilitySlot.findMany({
      where: {
        status: { in: [AvailabilitySlotStatus.DRAFT, AvailabilitySlotStatus.PUBLISHED] },
        startsAt: { lt: fixture.originalAvailabilityEndsAt },
        endsAt: { gt: fixture.manualStartsAt },
      },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true, endsAt: true, status: true },
    });
    assert.deepEqual(extendedSlots.map((slot) => [slot.startsAt, slot.endsAt, slot.status]), [
      [fixture.manualStartsAt, fixture.manualEndsAt, AvailabilitySlotStatus.DRAFT],
      [fixture.manualEndsAt, fixture.originalAvailabilityEndsAt, AvailabilitySlotStatus.PUBLISHED],
    ]);

    const cancellation = await applyAdminBookingStatusChange({
      bookingId: fixture.booking.id,
      targetStatus: BookingStatus.CANCELLED,
      actorUserId: fixture.owner.id,
      notifyClient: true,
      reason: "Manual override service resize regression",
    });

    assert.equal(cancellation.status, "success");
    const restoredSlots = await prisma.availabilitySlot.findMany({
      where: {
        status: { in: [AvailabilitySlotStatus.DRAFT, AvailabilitySlotStatus.PUBLISHED] },
        startsAt: { lt: fixture.originalAvailabilityEndsAt },
        endsAt: { gt: fixture.manualStartsAt },
      },
      select: { startsAt: true, endsAt: true, status: true },
    });
    assert.deepEqual(restoredSlots.map((slot) => [slot.startsAt, slot.endsAt, slot.status]), [
      [fixture.originalAvailabilityStartsAt, fixture.originalAvailabilityEndsAt, AvailabilitySlotStatus.PUBLISHED],
    ]);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("zkrácení cleanup blokace manual override obnoví PUBLISHED část", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const fixture = await createAdminManualOverrideResizeFixture(
    prisma,
    randomUUID().slice(0, 8),
    { originalDurationMinutes: 30, originalCleanupMinutes: 30 },
  );

  try {
    const result = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.shortService.id,
      actorUserId: fixture.owner.id,
    });

    assert.equal(result.status, "success");
    const updatedBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.booking.id },
      select: { scheduledEndsAt: true, blockedUntil: true },
    });
    assert.equal(updatedBooking.scheduledEndsAt.toISOString(), new Date(fixture.manualStartsAt.getTime() + 30 * 60 * 1000).toISOString());
    assert.equal(updatedBooking.blockedUntil?.toISOString(), new Date(fixture.manualStartsAt.getTime() + 30 * 60 * 1000).toISOString());

    const publishedSlots = await prisma.availabilitySlot.findMany({
      where: {
        status: AvailabilitySlotStatus.PUBLISHED,
        startsAt: { lt: fixture.originalAvailabilityEndsAt },
        endsAt: { gt: fixture.manualStartsAt },
      },
      select: { startsAt: true, endsAt: true },
    });
    assert.deepEqual(publishedSlots.map((slot) => [slot.startsAt, slot.endsAt]), [
      [fixture.originalAvailabilityStartsAt, fixture.originalAvailabilityEndsAt],
    ]);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("prodloužení manual override odmítne protected PUBLISHED overlap bez změny dat", async () => {
  const [{ prisma }, { updateAdminBookingService }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
  ]);
  const fixture = await createAdminManualOverrideResizeFixture(
    prisma,
    randomUUID().slice(0, 8),
    { originalDurationMinutes: 30 },
  );
  await prisma.availabilitySlot.update({
    where: { id: fixture.rightPublishedSlot.id },
    data: { internalNote: "Protected service-change overlap" },
  });

  try {
    const result = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.longService.id,
      actorUserId: fixture.owner.id,
    });

    assert.equal(result.status, "conflict");
    const [booking, draftSlot, protectedSlot] = await Promise.all([
      prisma.booking.findUniqueOrThrow({
        where: { id: fixture.booking.id },
        select: { serviceId: true, blockedUntil: true },
      }),
      prisma.availabilitySlot.findUniqueOrThrow({
        where: { id: fixture.manualOverrideSlot.id },
        select: { startsAt: true, endsAt: true, status: true },
      }),
      prisma.availabilitySlot.findUniqueOrThrow({
        where: { id: fixture.rightPublishedSlot.id },
        select: { startsAt: true, endsAt: true, status: true, internalNote: true },
      }),
    ]);
    assert.equal(booking.serviceId, fixture.originalService.id);
    assert.equal(booking.blockedUntil?.toISOString(), fixture.manualEndsAt.toISOString());
    assert.deepEqual(draftSlot, {
      startsAt: fixture.manualStartsAt,
      endsAt: fixture.manualEndsAt,
      status: AvailabilitySlotStatus.DRAFT,
    });
    assert.deepEqual(protectedSlot, {
      startsAt: fixture.manualEndsAt,
      endsAt: fixture.originalAvailabilityEndsAt,
      status: AvailabilitySlotStatus.PUBLISHED,
      internalNote: "Protected service-change overlap",
    });
  } finally {
    await fixture.cleanup();
  }
});

dbTest("reschedule po zkrácení manual override nenechá starý DRAFT ani mezeru", async () => {
  const [{ prisma }, { updateAdminBookingService }, { rescheduleBooking }] = await Promise.all([
    import("@/lib/prisma"),
    import("./admin-booking"),
    import("@/features/booking/lib/booking-rescheduling"),
  ]);
  const fixture = await createAdminManualOverrideResizeFixture(prisma, randomUUID().slice(0, 8));
  const newStartsAt = new Date(fixture.baseStartsAt.getTime() + 150 * 60 * 1000);

  try {
    const shortening = await updateAdminBookingService({
      bookingId: fixture.booking.id,
      serviceId: fixture.shortService.id,
      actorUserId: fixture.owner.id,
    });
    assert.equal(shortening.status, "success");

    const result = await rescheduleBooking({
      bookingId: fixture.booking.id,
      newStartAt: newStartsAt.toISOString(),
      changedByUserId: fixture.owner.id,
      allowManualOverride: true,
      notifyClient: false,
    });
    assert.equal(result.manualOverride, true);

    const oldAreaSlots = await prisma.availabilitySlot.findMany({
      where: {
        status: { in: [AvailabilitySlotStatus.DRAFT, AvailabilitySlotStatus.PUBLISHED] },
        startsAt: { lt: fixture.originalAvailabilityEndsAt },
        endsAt: { gt: fixture.manualStartsAt },
      },
      select: { startsAt: true, endsAt: true, status: true },
    });
    assert.deepEqual(oldAreaSlots.map((slot) => [slot.startsAt, slot.endsAt, slot.status]), [
      [fixture.originalAvailabilityStartsAt, fixture.originalAvailabilityEndsAt, AvailabilitySlotStatus.PUBLISHED],
    ]);

    const orphanDrafts = await prisma.availabilitySlot.count({
      where: {
        status: AvailabilitySlotStatus.DRAFT,
        startsAt: { gte: fixture.manualStartsAt, lt: fixture.originalAvailabilityEndsAt },
      },
    });
    assert.equal(orphanDrafts, 0);
  } finally {
    await fixture.cleanup();
  }
});
