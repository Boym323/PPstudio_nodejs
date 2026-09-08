import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  BookingStatus,
  VoucherStatus,
  VoucherType,
} from "@/generated/prisma/browser";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.NEXT_PUBLIC_APP_NAME ??= "PP Studio";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.EMAIL_DELIVERY_MODE ??= "log";

const dbTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

type PrismaClient = typeof import("@/lib/prisma")["prisma"];

async function createFixture(prisma: PrismaClient, suffix: string, voucherValueCzk = 2_000) {
  const actor = await prisma.adminUser.create({
    data: {
      email: `booking-concurrency-${suffix}@example.com`,
      name: `Booking concurrency ${suffix}`,
      role: "OWNER",
      isActive: true,
    },
    select: { id: true },
  });
  const category = await prisma.serviceCategory.create({
    data: {
      name: `Concurrency category ${suffix}`,
      slug: `concurrency-category-${suffix}`,
      isActive: true,
    },
    select: { id: true, name: true },
  });
  const service = await prisma.service.create({
    data: {
      categoryId: category.id,
      name: `Concurrency service ${suffix}`,
      slug: `concurrency-service-${suffix}`,
      durationMinutes: 60,
      priceFromCzk: 1_000,
      isActive: true,
      isPubliclyBookable: true,
    },
    select: { id: true, name: true },
  });
  const voucher = await prisma.voucher.create({
    data: {
      code: `CONCURRENCY-${suffix.toUpperCase()}`,
      type: VoucherType.VALUE,
      status: VoucherStatus.ACTIVE,
      originalValueCzk: voucherValueCzk,
      remainingValueCzk: voucherValueCzk,
      issuedAt: new Date(),
    },
    select: { id: true, code: true },
  });
  // Keep the fixture in a deterministic historical window that cannot overlap
  // with the rolling windows used by the other integration fixtures.
  const completedWindowEnd = new Date("2000-01-02T13:00:00.000Z");
  const completedWindowStart = new Date(completedWindowEnd.getTime() - 60 * 60 * 1_000);
  const bookings: Array<{
    booking: { id: string };
    client: { id: string; email: string | null };
    slot: { id: string };
  }> = [];

  for (let index = 0; index < 2; index += 1) {
    const slotStart = new Date(completedWindowStart.getTime() + index * 2 * 60 * 60 * 1_000);
    const slotEnd = new Date(completedWindowEnd.getTime() + index * 2 * 60 * 60 * 1_000);
    const client = await prisma.client.create({
      data: {
        fullName: `Concurrency client ${suffix}-${index}`,
        email: `booking-concurrency-${suffix}-${index}@example.com`,
        isActive: true,
      },
      select: { id: true, email: true },
    });
    const slot = await prisma.availabilitySlot.create({
      data: {
        startsAt: slotStart,
        endsAt: slotEnd,
        status: "PUBLISHED",
        capacity: 1,
      },
      select: { id: true },
    });
    const booking = await prisma.booking.create({
      data: {
        clientId: client.id,
        slotId: slot.id,
        serviceId: service.id,
        status: BookingStatus.CONFIRMED,
        source: "WEB",
        clientNameSnapshot: `Concurrency client ${suffix}-${index}`,
        clientEmailSnapshot: client.email ?? "",
        serviceNameSnapshot: service.name,
        serviceDurationMinutes: 60,
        servicePriceFromCzk: 1_000,
        scheduledStartsAt: slotStart,
        scheduledEndsAt: slotEnd,
        blockedUntil: slotEnd,
      },
      select: { id: true },
    });
    bookings.push({ booking, client, slot });
  }

  return {
    actor,
    category,
    service,
    voucher,
    bookings,
    async cleanup() {
      const bookingIds = bookings.map(({ booking }) => booking.id);
      const slotIds = bookings.map(({ slot }) => slot.id);
      const clientIds = bookings.map(({ client }) => client.id);
      await prisma.voucherRedemption.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.bookingPayment.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.emailLog.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await prisma.availabilitySlot.deleteMany({ where: { id: { in: slotIds } } });
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
      await prisma.voucher.deleteMany({ where: { id: voucher.id } });
      await prisma.service.deleteMany({ where: { id: service.id } });
      await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
      await prisma.adminUser.deleteMany({ where: { id: actor.id } });
    },
  };
}

async function completeConcurrently(
  bookingId: string,
  voucherCode: string,
  actorUserId: string,
  sharedBookingIds: string[],
  barrier: { arrive: () => Promise<void> },
  onRetry: (retryNumber: number) => void,
) {
  const [{ completeBookingVisitInTransaction }, { runSerializableTransaction }] = await Promise.all([
    import("@/features/admin/lib/booking/complete-booking-visit"),
    import("@/lib/serializable-transaction"),
  ]);

  return runSerializableTransaction(async (tx) => {
    // Model the concurrent voucher preflight read before the completion flow
    // locks and updates the same voucher row. The barrier makes both
    // PostgreSQL transactions reach this point before either can continue.
    await tx.voucher.findUnique({
      where: { code: voucherCode },
      select: { id: true, remainingValueCzk: true },
    });
    await tx.booking.findMany({
      where: { id: { in: sharedBookingIds } },
      select: { id: true, status: true },
    });
    await barrier.arrive();
    return completeBookingVisitInTransaction(tx, {
      bookingId,
      area: "owner",
      sessionEmail: "owner@example.com",
      sessionRole: "OWNER",
      actorUserId,
      mode: "voucher",
      voucherCode,
      voucherAmountCzk: 1_000,
      idempotencyKey: randomUUID(),
      note: null,
    });
  }, { onRetry: (retryNumber) => onRetry(retryNumber) });
}

function createBarrier(expectedArrivals: number) {
  let arrivals = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    arrive() {
      arrivals += 1;
      if (arrivals === expectedArrivals) release();
      return released;
    },
  };
}

dbTest("dokončení dvou rezervací se stejným voucherem zachová konzistenci při skutečném souběhu", async () => {
  const { prisma } = await import("@/lib/prisma");
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(prisma, suffix, 2_000);
  const retryNumbers: number[] = [];
  const barrier = createBarrier(fixture.bookings.length);

  try {
    const results = await Promise.allSettled(fixture.bookings.map(({ booking }) => completeConcurrently(
      booking.id,
      fixture.voucher.code,
      fixture.actor.id,
      fixture.bookings.map(({ booking: item }) => item.id),
      barrier,
      (retryNumber) => retryNumbers.push(retryNumber),
    )));

    assert.ok(retryNumbers.every((retryNumber) => retryNumber <= 4));
    assert.ok(results.every((result) => result.status === "fulfilled"));

    const [storedBookings, storedVoucher, redemptionCount, completionHistoryCount] = await Promise.all([
      prisma.booking.findMany({
        where: { id: { in: fixture.bookings.map(({ booking }) => booking.id) } },
        select: { status: true },
      }),
      prisma.voucher.findUniqueOrThrow({ where: { id: fixture.voucher.id }, select: { remainingValueCzk: true, status: true } }),
      prisma.voucherRedemption.count({ where: { voucherId: fixture.voucher.id } }),
      prisma.bookingStatusHistory.count({
        where: {
          bookingId: { in: fixture.bookings.map(({ booking }) => booking.id) },
          reason: "Voucher uplatněn při dokončení návštěvy",
        },
      }),
    ]);

    assert.deepEqual(storedBookings, [{ status: BookingStatus.COMPLETED }, { status: BookingStatus.COMPLETED }]);
    assert.deepEqual(storedVoucher, { remainingValueCzk: 0, status: VoucherStatus.REDEEMED });
    assert.equal(redemptionCount, 2);
    assert.equal(completionHistoryCount, 2);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("selhání druhého souběžného completion vrátí celou transakci bez částečného zápisu", async () => {
  const { prisma } = await import("@/lib/prisma");
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(prisma, suffix, 1_000);
  const retryNumbers: number[] = [];
  const barrier = createBarrier(fixture.bookings.length);

  try {
    const results = await Promise.allSettled(fixture.bookings.map(({ booking }) => completeConcurrently(
      booking.id,
      fixture.voucher.code,
      fixture.actor.id,
      fixture.bookings.map(({ booking: item }) => item.id),
      barrier,
      (retryNumber) => retryNumbers.push(retryNumber),
    )));

    assert.ok(retryNumbers.every((retryNumber) => retryNumber <= 4));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);

    const storedBookings = await prisma.booking.findMany({
      where: { id: { in: fixture.bookings.map(({ booking }) => booking.id) } },
      select: { status: true },
      orderBy: { id: "asc" },
    });
    const storedRedemptions = await prisma.voucherRedemption.findMany({
      where: { voucherId: fixture.voucher.id },
      select: { bookingId: true, amountCzk: true },
    });

    assert.equal(storedBookings.filter(({ status }) => status === BookingStatus.COMPLETED).length, 1);
    assert.equal(storedBookings.filter(({ status }) => status === BookingStatus.CONFIRMED).length, 1);
    assert.equal(storedRedemptions.length, 1);
    assert.equal(storedRedemptions[0]?.amountCzk, 1_000);
    assert.ok(fixture.bookings.some(({ booking }) => booking.id === storedRedemptions[0]?.bookingId));
    assert.equal((await prisma.voucher.findUniqueOrThrow({ where: { id: fixture.voucher.id }, select: { remainingValueCzk: true } })).remainingValueCzk, 0);
  } finally {
    await fixture.cleanup();
  }
});

dbTest("stale interní poznámka je odmítnuta bez silent lost update", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { updateAdminBookingInternalNote } = await import("@/features/admin/lib/admin-booking");
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(prisma, suffix);

  try {
    const initial = await prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookings[0].booking.id }, select: { updatedAt: true } });
    const first = await updateAdminBookingInternalNote({
      bookingId: fixture.bookings[0].booking.id,
      actorUserId: fixture.actor.id,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      internalNote: "Poznámka admina A",
    });
    const stale = await updateAdminBookingInternalNote({
      bookingId: fixture.bookings[0].booking.id,
      actorUserId: fixture.actor.id,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      internalNote: "Poznámka admina B",
    });

    assert.equal(first.status, "success");
    assert.equal(stale.status, "concurrent-modification");
    assert.deepEqual(
      await prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookings[0].booking.id }, select: { internalNote: true } }),
      { internalNote: "Poznámka admina A" },
    );
  } finally {
    await fixture.cleanup();
  }
});

dbTest("stale individuální cena je odmítnuta po změně ceny jiným adminem", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { updateAdminBookingPrice } = await import("@/features/admin/lib/admin-booking");
  const suffix = randomUUID().slice(0, 8);
  const fixture = await createFixture(prisma, suffix);

  try {
    const bookingId = fixture.bookings[0].booking.id;
    const initial = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { updatedAt: true } });
    const first = await updateAdminBookingPrice({
      bookingId,
      actorUserId: fixture.actor.id,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      nextFinalPriceCzk: 900,
      normalizedReason: "Úprava admina A",
      confirmOverpayment: false,
    });
    const stale = await updateAdminBookingPrice({
      bookingId,
      actorUserId: fixture.actor.id,
      expectedUpdatedAt: initial.updatedAt.toISOString(),
      nextFinalPriceCzk: 800,
      normalizedReason: "Úprava admina B",
      confirmOverpayment: false,
    });

    assert.equal(first.status, "updated");
    assert.equal(stale.status, "concurrent-modification");
    assert.deepEqual(
      await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { finalPriceCzk: true, priceAdjustmentReason: true } }),
      { finalPriceCzk: 900, priceAdjustmentReason: "Úprava admina A" },
    );
  } finally {
    await fixture.cleanup();
  }
});
