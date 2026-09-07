import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AvailabilitySlotServiceRestrictionMode,
  AvailabilitySlotStatus,
  BookingStatus,
} from "@/generated/prisma/browser";

process.env.NEXT_PUBLIC_APP_NAME ??= "PP Studio";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.ADMIN_OWNER_PASSWORD ??= "change-me-owner";
process.env.ADMIN_STAFF_EMAIL ??= "staff@example.com";
process.env.ADMIN_STAFF_PASSWORD ??= "change-me-staff";
process.env.EMAIL_DELIVERY_MODE = "log";

function buildSlot(overrides: Partial<{
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: AvailabilitySlotStatus;
  serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode;
  allowedServices: Array<{ serviceId: string }>;
}> = {}) {
  return {
    id: overrides.id ?? "slot-current",
    startsAt: overrides.startsAt ?? new Date("2026-04-26T09:00:00.000Z"),
    endsAt: overrides.endsAt ?? new Date("2026-04-26T10:00:00.000Z"),
    capacity: overrides.capacity ?? 1,
    status: overrides.status ?? AvailabilitySlotStatus.PUBLISHED,
    serviceRestrictionMode:
      overrides.serviceRestrictionMode ?? AvailabilitySlotServiceRestrictionMode.ANY,
    publicNote: null,
    internalNote: null,
    publishedAt: new Date("2026-04-20T09:00:00.000Z"),
    cancelledAt: null,
    createdByUserId: null,
    allowedServices: overrides.allowedServices ?? [],
  };
}

function buildBooking(overrides: Partial<{
  id: string;
  status: BookingStatus;
  slotId: string;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  serviceDurationMinutes: number;
  cleanupMinutes: number;
  cleanupBlockMinutes: number;
  blockedUntil: Date;
  updatedAt: Date;
  slot: ReturnType<typeof buildSlot>;
  manualOverride: boolean;
  rescheduleCount: number;
  clientEmailSnapshot: string;
  voucherRedemptions: Array<{ id: string }>;
}> = {}) {
  const scheduledStartsAt = overrides.scheduledStartsAt ?? new Date("2026-04-26T09:00:00.000Z");
  const scheduledEndsAt =
    overrides.scheduledEndsAt ?? new Date(scheduledStartsAt.getTime() + 60 * 60 * 1000);
  const slot = overrides.slot ?? buildSlot({
    id: overrides.slotId ?? "slot-current",
    startsAt: scheduledStartsAt,
    endsAt: scheduledEndsAt,
  });

  return {
    id: overrides.id ?? "booking-1",
    status: overrides.status ?? BookingStatus.CONFIRMED,
    slotId: overrides.slotId ?? slot.id,
    serviceId: "service-1",
    serviceDurationMinutes: overrides.serviceDurationMinutes ?? 60,
    cleanupMinutes: overrides.cleanupMinutes ?? 0,
    cleanupBlockMinutes: overrides.cleanupBlockMinutes ?? 0,
    serviceNameSnapshot: "Lash lifting",
    scheduledStartsAt,
    scheduledEndsAt,
    blockedUntil: overrides.blockedUntil ?? scheduledEndsAt,
    clientId: "client-1",
    clientNameSnapshot: "Jana Nováková",
    clientEmailSnapshot: overrides.clientEmailSnapshot ?? "jana@example.com",
    communicationGeneration: 1,
    clientPhoneSnapshot: "+420777000000",
    clientNote: null,
    manualOverride: overrides.manualOverride ?? false,
    updatedAt: overrides.updatedAt ?? new Date("2026-04-23T09:00:00.000Z"),
    rescheduleCount: overrides.rescheduleCount ?? 0,
    voucherRedemptions: overrides.voucherRedemptions ?? [],
    slot,
  };
}

async function createHarness(overrides: Partial<{
  booking: ReturnType<typeof buildBooking> | null;
  requestedSlot: ReturnType<typeof buildSlot> | null;
  overlappingSlots: Array<ReturnType<typeof buildSlot>>;
  activeBookingCount: number;
  withinWindow: boolean;
  failEmailLog: boolean;
  serializableFailures: number;
  pendingReminderPayloads: unknown[];
}> = {}) {
  const { createBookingReschedulingApi } = await import("./booking-rescheduling");

  const booking = overrides.booking === undefined ? buildBooking() : overrides.booking;
  const requestedSlot = overrides.requestedSlot === undefined
    ? buildSlot({
        id: "slot-new",
        startsAt: new Date("2026-04-28T09:00:00.000Z"),
        endsAt: new Date("2026-04-28T10:00:00.000Z"),
      })
    : overrides.requestedSlot;

  const calls = {
    bookingUpdate: [] as Array<Record<string, unknown>>,
    bookingCount: [] as Array<Record<string, unknown>>,
    logCreate: [] as Array<Record<string, unknown>>,
    slotCreate: [] as Array<Record<string, unknown>>,
    slotUpdate: [] as Array<Record<string, unknown>>,
    slotDelete: [] as Array<Record<string, unknown>>,
    actionTokenCreate: [] as Array<Record<string, unknown>>,
    actionTokenUpdateMany: [] as Array<Record<string, unknown>>,
    emailLogCreate: [] as Array<Record<string, unknown>>,
    emailLogUpdate: [] as Array<Record<string, unknown>>,
    notification: [] as Array<Record<string, unknown>>,
    pushover: [] as Array<Record<string, unknown>>,
  };

  let queryRawCalls = 0;
  const tx = {
    $queryRaw: async () => {
      queryRawCalls += 1;

      if (queryRawCalls === 1) {
        return booking ? [{ id: booking.id }] : [];
      }

      return requestedSlot ? [{ id: requestedSlot.id }] : [];
    },
    booking: {
      findUnique: async () => booking,
      findMany: async () => [],
      count: async (input: Record<string, unknown>) => {
        calls.bookingCount.push(input);
        return overrides.activeBookingCount ?? 0;
      },
      update: async (input: Record<string, unknown>) => {
        calls.bookingUpdate.push(input);
        return {};
      },
    },
    availabilitySlot: {
      findUnique: async () => requestedSlot,
      findMany: async () => overrides.overlappingSlots ?? [],
      create: async (input: Record<string, unknown>) => {
        calls.slotCreate.push(input);
        return buildSlot({
          id: "slot-manual",
          startsAt: new Date("2026-04-28T09:00:00.000Z"),
          endsAt: new Date("2026-04-28T10:00:00.000Z"),
          status: AvailabilitySlotStatus.DRAFT,
        });
      },
      update: async (input: Record<string, unknown>) => {
        calls.slotUpdate.push(input);
        return {};
      },
      delete: async (input: Record<string, unknown>) => {
        calls.slotDelete.push(input);
        return {};
      },
    },
    siteSettings: {
      findUnique: async () => ({ autoLunchEnabled: true }),
    },
    autoLunchDayOverride: {
      findMany: async () => [],
    },
    bookingRescheduleLog: {
      create: async (input: Record<string, unknown>) => {
        calls.logCreate.push(input);
        return {};
      },
    },
    bookingActionToken: {
      create: async (input: Record<string, unknown>) => {
        calls.actionTokenCreate.push(input);
        return { id: "action-token-1" };
      },
      updateMany: async (input: Record<string, unknown>) => {
        calls.actionTokenUpdateMany.push(input);
        return { count: 1 };
      },
    },
    emailLog: {
      findMany: async () => (overrides.pendingReminderPayloads ?? []).map((payload) => ({
        payload,
        communicationGeneration: 1,
        recipientEmail: "jana@example.com",
        processingStartedAt: null,
      })),
      update: async (input: Record<string, unknown>) => {
        calls.emailLogUpdate.push(input);
      },
      create: async (input: Record<string, unknown>) => {
        if (overrides.failEmailLog) {
          throw new Error("EmailLog create failed");
        }

        calls.emailLogCreate.push(input);
        return { id: "email-log-1" };
      },
    },
  };

  let remainingSerializableFailures = overrides.serializableFailures ?? 0;
  const transactionalCalls = [
    calls.bookingUpdate,
    calls.bookingCount,
    calls.logCreate,
    calls.slotCreate,
    calls.slotUpdate,
    calls.slotDelete,
    calls.actionTokenCreate,
    calls.actionTokenUpdateMany,
    calls.emailLogCreate,
    calls.emailLogUpdate,
  ];

  const api = createBookingReschedulingApi({
    prisma: {
      $transaction: async (callback: (transaction: typeof tx) => unknown) => {
        queryRawCalls = 0;
        const sizesBeforeTransaction = transactionalCalls.map((items) => items.length);

        try {
          const result = await callback(tx);

          if (remainingSerializableFailures > 0) {
            remainingSerializableFailures -= 1;
            throw {
              name: "DriverAdapterError",
              cause: { kind: "TransactionWriteConflict" },
            };
          }

          return result;
        } catch (error) {
          transactionalCalls.forEach((items, index) => {
            items.length = sizesBeforeTransaction[index] ?? 0;
          });
          throw error;
        }
      },
    } as never,
    getBookingPolicySettings: async () => ({
      minAdvanceHours: 2,
      maxAdvanceDays: 90,
      cancellationHours: 48,
    }),
    isBookingWithinWindow: () => overrides.withinWindow ?? true,
    queueBookingRescheduledNotification: async (input) => {
      calls.notification.push(input as Record<string, unknown>);
    },
    sendOwnerBookingPushover: async (input) => {
      calls.pushover.push(input as Record<string, unknown>);
    },
    sendOwnerSystemErrorPushover: async () => {},
  });

  return {
    api,
    booking,
    requestedSlot,
    calls,
  };
}

function expectRescheduleErrorCode(
  error: unknown,
  expectedCode: string,
) {
  assert.equal(typeof error, "object");
  assert.ok(error);
  const typedError = error as Record<string, unknown>;
  assert.equal("code" in typedError, true);
  assert.equal((typedError as { code: string }).code, expectedCode);
}

describe("state validation", () => {
  test("allows confirmed booking to be rescheduled when the new slot is available", async () => {
    const harness = await createHarness({
      booking: buildBooking({ status: BookingStatus.CONFIRMED }),
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: true,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.bookingId, "booking-1");
  });

  test("allows pending booking to be rescheduled when the new slot is available", async () => {
    const harness = await createHarness({
      booking: buildBooking({ status: BookingStatus.PENDING }),
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: false,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.bookingId, "booking-1");
    assert.equal(result.notificationStatus, "skipped");
  });

  test("ignores an overlapping archived slot left by a cancelled booking", async () => {
    const harness = await createHarness({
      overlappingSlots: [
        buildSlot({
          id: "slot-archived-history",
          startsAt: new Date("2026-04-28T08:30:00.000Z"),
          endsAt: new Date("2026-04-28T10:30:00.000Z"),
          status: AvailabilitySlotStatus.ARCHIVED,
        }),
      ],
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: false,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.bookingId, "booking-1");
    assert.equal(result.manualOverride, false);
  });

  test("keeps an overlapping draft slot as an internal block", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      overlappingSlots: [
        buildSlot({
          id: "slot-draft-block",
          startsAt: new Date("2026-04-28T08:30:00.000Z"),
          endsAt: new Date("2026-04-28T10:30:00.000Z"),
          status: AvailabilitySlotStatus.DRAFT,
        }),
      ],
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: false,
        expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.conflict);
        return true;
      },
    );
  });

  for (const status of [
    AvailabilitySlotStatus.DRAFT,
    AvailabilitySlotStatus.ARCHIVED,
    AvailabilitySlotStatus.CANCELLED,
  ]) {
    test(`client reschedule rejects requested ${status} slot`, async () => {
      const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
      const harness = await createHarness({
        requestedSlot: buildSlot({
          id: `slot-${status.toLowerCase()}`,
          startsAt: new Date("2026-04-28T09:00:00.000Z"),
          endsAt: new Date("2026-04-28T10:00:00.000Z"),
          status,
        }),
      });

      await assert.rejects(
        harness.api.rescheduleBooking({
          bookingId: "booking-1",
          slotId: `slot-${status.toLowerCase()}`,
          newStartAt: "2026-04-28T09:00:00.000Z",
          changedByUserId: null,
          changedByClient: true,
          notifyClient: false,
          expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
        }),
        (error) => {
          expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.slotNotAllowed);
          return true;
        },
      );
    });
  }

  test("uses a current published slot as anchor instead of an archived requested slot", async () => {
    const harness = await createHarness({
      requestedSlot: buildSlot({
        id: "slot-archived-requested",
        startsAt: new Date("2026-04-28T09:00:00.000Z"),
        endsAt: new Date("2026-04-28T10:00:00.000Z"),
        status: AvailabilitySlotStatus.ARCHIVED,
      }),
      overlappingSlots: [
        buildSlot({
          id: "slot-published-anchor",
          startsAt: new Date("2026-04-28T09:00:00.000Z"),
          endsAt: new Date("2026-04-28T10:00:00.000Z"),
          status: AvailabilitySlotStatus.PUBLISHED,
        }),
      ],
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-archived-requested",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: false,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.manualOverride, false);
    assert.equal((harness.calls.bookingUpdate[0]?.data as { slotId?: string }).slotId, "slot-published-anchor");
  });

  test("uses current contiguous coverage when the requested slotId no longer exists", async () => {
    const harness = await createHarness({
      requestedSlot: null,
      overlappingSlots: [
        buildSlot({
          id: "slot-current-published",
          startsAt: new Date("2026-04-28T09:00:00.000Z"),
          endsAt: new Date("2026-04-28T10:00:00.000Z"),
          status: AvailabilitySlotStatus.PUBLISHED,
        }),
      ],
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-stale",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: false,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.manualOverride, false);
    assert.equal((harness.calls.bookingUpdate[0]?.data as { slotId?: string }).slotId, "slot-current-published");
  });

  test("allows reschedule across adjacent published slots and uses the whole chain in conflict checks", async () => {
    const harness = await createHarness({
      booking: buildBooking({
        serviceDurationMinutes: 120,
      }),
      requestedSlot: buildSlot({
        id: "slot-new",
        startsAt: new Date("2026-04-28T09:30:00.000Z"),
        endsAt: new Date("2026-04-28T10:00:00.000Z"),
      }),
      overlappingSlots: [
        buildSlot({
          id: "slot-follow-up",
          startsAt: new Date("2026-04-28T10:00:00.000Z"),
          endsAt: new Date("2026-04-28T11:30:00.000Z"),
        }),
      ],
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:30:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: false,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.bookingId, "booking-1");
    assert.deepEqual(harness.calls.bookingCount[0], {
      where: {
        id: {
          not: "booking-1",
        },
        status: {
          in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
        },
        scheduledStartsAt: {
          lt: new Date("2026-04-28T11:30:00.000Z"),
        },
        OR: [
          {
            blockedUntil: {
              gt: new Date("2026-04-28T09:30:00.000Z"),
            },
          },
          {
            blockedUntil: null,
            scheduledEndsAt: {
              gt: new Date("2026-04-28T09:30:00.000Z"),
            },
          },
        ],
      },
    });
  });

  test("allows reschedule when cleanup overflows past the selected slot end", async () => {
    const harness = await createHarness({
      booking: buildBooking({
        cleanupMinutes: 10,
        cleanupBlockMinutes: 15,
        blockedUntil: new Date("2026-04-26T10:15:00.000Z"),
      }),
      requestedSlot: buildSlot({
        id: "slot-new",
        startsAt: new Date("2026-04-28T09:00:00.000Z"),
        endsAt: new Date("2026-04-28T10:00:00.000Z"),
      }),
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: false,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.bookingId, "booking-1");
    assert.deepEqual(harness.calls.bookingUpdate[0]?.data, {
      slotId: "slot-new",
      scheduledStartsAt: new Date("2026-04-28T09:00:00.000Z"),
      scheduledEndsAt: new Date("2026-04-28T10:00:00.000Z"),
      blockedUntil: new Date("2026-04-28T10:15:00.000Z"),
      originalAvailabilityEndsAt: new Date("2026-04-28T10:00:00.000Z"),
      manualOverride: false,
      rescheduledAt: harness.calls.bookingUpdate[0]?.data
        ? (harness.calls.bookingUpdate[0].data as { rescheduledAt: Date }).rescheduledAt
        : undefined,
      rescheduleCount: {
        increment: 1,
      },
      reminder24hQueuedAt: null,
      reminder24hSentAt: null,
      communicationGeneration: {
        increment: 1,
      },
    });
  });

  test("allows moving to an earlier start that uses the free slot before the current booking", async () => {
    const harness = await createHarness({
      booking: buildBooking({
        slotId: "slot-current",
        scheduledStartsAt: new Date("2026-04-28T10:00:00.000Z"),
        scheduledEndsAt: new Date("2026-04-28T11:00:00.000Z"),
        serviceDurationMinutes: 60,
        slot: buildSlot({
          id: "slot-current",
          startsAt: new Date("2026-04-28T10:00:00.000Z"),
          endsAt: new Date("2026-04-28T11:00:00.000Z"),
        }),
      }),
      requestedSlot: null,
      overlappingSlots: [
        buildSlot({
          id: "slot-before",
          startsAt: new Date("2026-04-28T09:00:00.000Z"),
          endsAt: new Date("2026-04-28T10:00:00.000Z"),
        }),
      ],
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-current",
      newStartAt: "2026-04-28T09:30:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: false,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.scheduledStartsAt, "2026-04-28T09:30:00.000Z");
    assert.equal(result.manualOverride, false);
    assert.deepEqual(harness.calls.bookingUpdate[0]?.data, {
      slotId: "slot-before",
      scheduledStartsAt: new Date("2026-04-28T09:30:00.000Z"),
      scheduledEndsAt: new Date("2026-04-28T10:30:00.000Z"),
      blockedUntil: new Date("2026-04-28T10:30:00.000Z"),
      originalAvailabilityEndsAt: new Date("2026-04-28T11:00:00.000Z"),
      manualOverride: false,
      rescheduledAt: harness.calls.bookingUpdate[0]?.data
        ? (harness.calls.bookingUpdate[0].data as { rescheduledAt: Date }).rescheduledAt
        : undefined,
      rescheduleCount: {
        increment: 1,
      },
      reminder24hQueuedAt: null,
      reminder24hSentAt: null,
      communicationGeneration: {
        increment: 1,
      },
    });
  });

  test("rejects reschedule when booking is cancelled", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      booking: buildBooking({ status: BookingStatus.CANCELLED }),
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.statusNotAllowed);
        return true;
      },
    );
  });

  test("rejects reschedule when an active booking already has voucher redemption", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      booking: buildBooking({
        voucherRedemptions: [{ id: "redemption-1" }],
      }),
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.statusNotAllowed);
        assert.match((error as Error).message, /voucherové čerpání/i);
        return true;
      },
    );
  });

  test("rejects reschedule when booking is completed", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      booking: buildBooking({ status: BookingStatus.COMPLETED }),
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.statusNotAllowed);
        return true;
      },
    );
  });

  test("rejects reschedule when booking is marked as no-show", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      booking: buildBooking({ status: BookingStatus.NO_SHOW }),
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.statusNotAllowed);
        return true;
      },
    );
  });
});

describe("reschedule booking", () => {
  async function rescheduleToRelativeTarget(
    offsetHours: number,
    options: { notifyClient?: boolean; serializableFailures?: number } = {},
  ) {
    const startsAt = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const harness = await createHarness({
      requestedSlot: buildSlot({
        id: "slot-new",
        startsAt,
        endsAt,
      }),
      serializableFailures: options.serializableFailures,
    });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: startsAt.toISOString(),
      changedByUserId: "admin-1",
      notifyClient: options.notifyClient ?? false,
    });

    return { harness, result, startsAt, endsAt };
  }

  test("před enqueue window pouze resetuje reminder state", async () => {
    const { harness, startsAt } = await rescheduleToRelativeTarget(27);

    assert.equal(harness.calls.emailLogCreate.length, 0);
    assert.deepEqual(harness.calls.bookingUpdate[0]?.data, {
      slotId: "slot-new",
      scheduledStartsAt: startsAt,
      scheduledEndsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      blockedUntil: new Date(startsAt.getTime() + 60 * 60 * 1000),
      originalAvailabilityEndsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      manualOverride: false,
      rescheduledAt: harness.calls.bookingUpdate[0]?.data
        ? (harness.calls.bookingUpdate[0].data as { rescheduledAt: Date }).rescheduledAt
        : undefined,
      rescheduleCount: { increment: 1 },
      reminder24hQueuedAt: null,
      reminder24hSentAt: null,
      communicationGeneration: { increment: 1 },
    });
  });

  test("uvnitř enqueue window založí reminder okamžitě", async () => {
    const { harness, startsAt, endsAt } = await rescheduleToRelativeTarget(25.5);

    assert.equal(harness.calls.emailLogCreate.length, 1);
    assert.equal(harness.calls.actionTokenCreate.length, 2);
    const reminderLog = harness.calls.emailLogCreate[0]?.data as {
      type: string;
      payload: Record<string, unknown>;
    };
    assert.equal(reminderLog.type, "BOOKING_REMINDER");
    assert.equal(reminderLog.payload.scheduledStartsAt, startsAt.toISOString());
    assert.equal(reminderLog.payload.scheduledEndsAt, endsAt.toISOString());
    assert.equal((harness.calls.bookingUpdate[0]?.data as { reminder24hQueuedAt: null }).reminder24hQueuedAt, null);
    assert.equal((harness.calls.bookingUpdate[0]?.data as { reminder24hSentAt: null }).reminder24hSentAt, null);
  });

  test("po opuštění enqueue window vytvoří catch-up reminder i bez reschedule notifikace", async () => {
    const { harness, result, startsAt, endsAt } = await rescheduleToRelativeTarget(20);

    assert.equal(result.notificationStatus, "skipped");
    assert.equal(harness.calls.emailLogCreate.length, 1);
    const reminderLog = harness.calls.emailLogCreate[0]?.data as {
      type: string;
      audience: string;
      payload: Record<string, unknown>;
    };
    assert.equal(reminderLog.type, "BOOKING_REMINDER");
    assert.equal(reminderLog.audience, "CLIENT");
    assert.equal(reminderLog.payload.bookingId, "booking-1");
    assert.equal(reminderLog.payload.serviceId, "service-1");
    assert.equal(reminderLog.payload.scheduledStartsAt, startsAt.toISOString());
    assert.equal(reminderLog.payload.scheduledEndsAt, endsAt.toISOString());
  });

  test("po začátku rezervace catch-up reminder nevytvoří", async () => {
    const { harness } = await rescheduleToRelativeTarget(-1);

    assert.equal(harness.calls.emailLogCreate.length, 0);
    assert.equal((harness.calls.bookingUpdate[0]?.data as { reminder24hQueuedAt: null }).reminder24hQueuedAt, null);
    assert.equal((harness.calls.bookingUpdate[0]?.data as { reminder24hSentAt: null }).reminder24hSentAt, null);
  });

  test("catch-up reminder se při serializable retry neduplikuje", async () => {
    const { harness } = await rescheduleToRelativeTarget(20, { serializableFailures: 1 });

    assert.equal(harness.calls.emailLogCreate.length, 1);
    assert.equal(harness.calls.actionTokenCreate.length, 2);
  });

  test("existující current PENDING reminder se při catch-upu neduplikuje", async () => {
    const startsAt = new Date(Date.now() + 20 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const harness = await createHarness({
      requestedSlot: buildSlot({
        id: "slot-new",
        startsAt,
        endsAt,
      }),
      pendingReminderPayloads: [{
        bookingId: "booking-1",
        serviceId: "service-1",
        scheduledStartsAt: startsAt.toISOString(),
        scheduledEndsAt: endsAt.toISOString(),
      }],
    });

    await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: startsAt.toISOString(),
      changedByUserId: "admin-1",
      notifyClient: false,
    });

    assert.equal(harness.calls.emailLogCreate.length, 0);
    assert.equal(harness.calls.actionTokenCreate.length, 0);
  });

  test("reschedules to a new available slot and returns the updated booking result", async () => {
    const harness = await createHarness();

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: true,
      includeCalendarAttachment: true,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(result.bookingId, "booking-1");
    assert.equal(result.scheduledStartsAt, "2026-04-28T09:00:00.000Z");
    assert.equal(result.scheduledEndsAt, "2026-04-28T10:00:00.000Z");
    assert.equal(result.notificationStatus, "logged");
    assert.equal(harness.calls.bookingUpdate.length, 1);
  });

  test("vytvoření klientského EmailLog selže transakčně spolu s přesunem", async () => {
    const harness = await createHarness({ failEmailLog: true });

    await assert.rejects(() => harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: true,
    }), /EmailLog create failed/);

    assert.equal(harness.calls.bookingUpdate.length, 0);
    assert.equal(harness.calls.logCreate.length, 0);
    assert.equal(harness.calls.actionTokenCreate.length, 0);
    assert.equal(harness.calls.actionTokenUpdateMany.length, 0);
    assert.equal(harness.calls.emailLogCreate.length, 0);
    assert.equal(harness.calls.notification.length, 0);
  });

  test("synchronizuje aktivní klientské tokeny i bez klientského e-mailu", async () => {
    const harness = await createHarness();

    await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: "admin-1",
      notifyClient: false,
    });

    assert.equal(harness.calls.actionTokenUpdateMany.length, 1);
    const synchronization = harness.calls.actionTokenUpdateMany[0];
    assert.ok(synchronization);
    const synchronizationWhere = synchronization.where as {
      bookingId: string;
      type: { in: string[] };
      usedAt: null;
      revokedAt: null;
      expiresAt: { gt: Date };
    };
    assert.deepEqual({
      bookingId: synchronizationWhere.bookingId,
      type: synchronizationWhere.type,
      usedAt: synchronizationWhere.usedAt,
      revokedAt: synchronizationWhere.revokedAt,
    }, {
      bookingId: "booking-1",
      type: {
        in: ["RESCHEDULE", "CANCEL"],
      },
      usedAt: null,
      revokedAt: null,
    });
    assert.ok(synchronizationWhere.expiresAt.gt instanceof Date);
    assert.deepEqual(synchronization.data, {
      expiresAt: new Date("2026-04-28T11:00:00.000Z"),
    });
  });

  test("při pozdějším i dřívějším přesunu používá nový termín pro expiraci", async () => {
    for (const newStartAt of [
      "2026-05-28T09:00:00.000Z",
      "2026-04-20T09:00:00.000Z",
    ]) {
      const harness = await createHarness({
        requestedSlot: buildSlot({
          id: "slot-new",
          startsAt: new Date(newStartAt),
          endsAt: new Date(new Date(newStartAt).getTime() + 60 * 60 * 1000),
        }),
      });

      await harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt,
        changedByUserId: "admin-1",
        notifyClient: false,
      });

      assert.equal(
        (harness.calls.actionTokenUpdateMany[0]?.data as { expiresAt: Date }).expiresAt.toISOString(),
        new Date(new Date(newStartAt).getTime() + 2 * 60 * 60 * 1000).toISOString(),
      );
    }
  });

  test("serializable retry zachová jediný klientský EmailLog a jedinou dvojici tokenů", async () => {
    const harness = await createHarness({ serializableFailures: 1 });

    const result = await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: true,
    });

    assert.equal(result.notificationStatus, "logged");
    assert.equal(harness.calls.bookingUpdate.length, 1);
    assert.equal(harness.calls.logCreate.length, 1);
    assert.equal(harness.calls.actionTokenCreate.length, 2);
    assert.equal(harness.calls.emailLogCreate.length, 1);
  });

  test("uses cleanup snapshot for the new internal collision interval", async () => {
    const harness = await createHarness({
      booking: buildBooking({
        cleanupMinutes: 10,
        cleanupBlockMinutes: 15,
      }),
      requestedSlot: buildSlot({
        id: "slot-new",
        startsAt: new Date("2026-04-28T09:00:00.000Z"),
        endsAt: new Date("2026-04-28T10:15:00.000Z"),
      }),
    });

    await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: false,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.deepEqual(harness.calls.bookingCount[0]?.where, {
      id: {
        not: "booking-1",
      },
      status: {
        in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
      },
      scheduledStartsAt: {
        lt: new Date("2026-04-28T10:15:00.000Z"),
      },
      OR: [
        {
          blockedUntil: {
            gt: new Date("2026-04-28T09:00:00.000Z"),
          },
        },
        {
          blockedUntil: null,
          scheduledEndsAt: {
            gt: new Date("2026-04-28T09:00:00.000Z"),
          },
        },
      ],
    });
    assert.equal(
      (harness.calls.bookingUpdate[0]?.data as { blockedUntil?: Date }).blockedUntil?.toISOString(),
      "2026-04-28T10:15:00.000Z",
    );
  });

  test("rejects reschedule when the new term is the same as the current one", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      booking: buildBooking(),
      requestedSlot: buildSlot({
        id: "slot-current",
        startsAt: new Date("2026-04-26T09:00:00.000Z"),
        endsAt: new Date("2026-04-26T10:00:00.000Z"),
      }),
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-current",
        newStartAt: "2026-04-26T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.sameTerm);
        return true;
      },
    );

    assert.equal(harness.calls.bookingUpdate.length, 0);
    assert.equal(harness.calls.logCreate.length, 0);
    assert.equal(harness.calls.notification.length, 0);
  });

  test("rejects reschedule when the new slot collides with another active booking", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      activeBookingCount: 1,
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.conflict);
        return true;
      },
    );

    assert.equal(harness.calls.bookingUpdate.length, 0);
    assert.equal(harness.calls.logCreate.length, 0);
    assert.equal(harness.calls.notification.length, 0);
  });

  test("rejects reschedule when the selected slot is shorter than the service duration", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      requestedSlot: buildSlot({
        id: "slot-short",
        startsAt: new Date("2026-04-28T09:00:00.000Z"),
        endsAt: new Date("2026-04-28T09:30:00.000Z"),
      }),
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-short",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.slotTooShort);
        return true;
      },
    );

    assert.equal(harness.calls.bookingUpdate.length, 0);
  });

  test("neplatné expectedUpdatedAt nesmí obejít kontrolu souběžné změny", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness();

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
        expectedUpdatedAt: "neplatné datum",
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.concurrentModification);
        return true;
      },
    );

    assert.equal(harness.calls.bookingUpdate.length, 0);
    assert.equal(harness.calls.logCreate.length, 0);
    assert.equal(harness.calls.notification.length, 0);
  });

  test("rejects reschedule when expected updatedAt does not match", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness();

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
        expectedUpdatedAt: "2026-04-23T08:59:59.000Z",
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.concurrentModification);
        return true;
      },
    );

    assert.equal(harness.calls.bookingUpdate.length, 0);
    assert.equal(harness.calls.logCreate.length, 0);
  });
});

describe("history and side effects", () => {
  test("writes reschedule log with client-originated metadata and triggers notification on success", async () => {
    const harness = await createHarness();

    await harness.api.rescheduleBooking({
      bookingId: "booking-1",
      slotId: "slot-new",
      newStartAt: "2026-04-28T09:00:00.000Z",
      changedByUserId: null,
      changedByClient: true,
      notifyClient: true,
      includeCalendarAttachment: true,
      expectedUpdatedAt: "2026-04-23T09:00:00.000Z",
    });

    assert.equal(harness.calls.logCreate.length, 1);
    assert.deepEqual(harness.calls.logCreate[0], {
      data: {
        bookingId: "booking-1",
        oldStartAt: new Date("2026-04-26T09:00:00.000Z"),
        oldEndAt: new Date("2026-04-26T10:00:00.000Z"),
        newStartAt: new Date("2026-04-28T09:00:00.000Z"),
        newEndAt: new Date("2026-04-28T10:00:00.000Z"),
        changedByUserId: null,
        changedByClient: true,
        reason: null,
      },
    });
    assert.equal(harness.calls.notification.length, 1);
    assert.deepEqual(harness.calls.notification[0], {
      bookingId: "booking-1",
      clientId: "client-1",
      serviceId: "service-1",
      clientEmail: "jana@example.com",
      clientName: "Jana Nováková",
      serviceName: "Lash lifting",
      previousStartsAt: new Date("2026-04-26T09:00:00.000Z"),
      previousEndsAt: new Date("2026-04-26T10:00:00.000Z"),
      scheduledStartsAt: new Date("2026-04-28T09:00:00.000Z"),
      scheduledEndsAt: new Date("2026-04-28T10:00:00.000Z"),
      includeCalendarAttachment: true,
      notifyAdminOnClientReschedule: true,
    });
    const clientEmailLog = harness.calls.emailLogCreate[0]?.data as Record<string, unknown>;
    assert.equal(clientEmailLog.audience, "CLIENT");
    assert.equal(clientEmailLog.type, "BOOKING_RESCHEDULED");
    assert.equal(
      (clientEmailLog.payload as Record<string, unknown>).scheduledStartsAt,
      "2026-04-28T09:00:00.000Z",
    );
    assert.equal(
      (clientEmailLog.payload as Record<string, unknown>).scheduledEndsAt,
      "2026-04-28T10:00:00.000Z",
    );
    assert.equal(
      (clientEmailLog.payload as Record<string, unknown>).serviceId,
      "service-1",
    );
    assert.equal(harness.calls.pushover.length, 1);
    assert.deepEqual(harness.calls.pushover[0], {
      type: "BOOKING_RESCHEDULED",
      bookingId: "booking-1",
      sourceLabel: "Web",
      previousStartsAt: new Date("2026-04-26T09:00:00.000Z"),
      previousEndsAt: new Date("2026-04-26T10:00:00.000Z"),
    });
  });

  test("does not write history or enqueue notification when reschedule fails", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      activeBookingCount: 1,
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.conflict);
        return true;
      },
    );

    assert.equal(harness.calls.logCreate.length, 0);
    assert.equal(harness.calls.notification.length, 0);
    assert.equal(harness.calls.pushover.length, 0);
  });
});

describe("error handling", () => {
  test("returns not found business error when booking does not exist", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness({
      booking: null,
    });

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "missing-booking",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.notFound);
        return true;
      },
    );
  });

  test("returns invalid date time business error when new start time is missing or invalid", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness();

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.invalidDateTime);
        return true;
      },
    );
  });

  test("returns invalid date time business error when new end time breaks service duration", async () => {
    const { bookingRescheduleErrorCodes } = await import("./booking-rescheduling");
    const harness = await createHarness();

    await assert.rejects(
      harness.api.rescheduleBooking({
        bookingId: "booking-1",
        slotId: "slot-new",
        newStartAt: "2026-04-28T09:00:00.000Z",
        newEndAt: "2026-04-28T09:45:00.000Z",
        changedByUserId: null,
        changedByClient: true,
        notifyClient: true,
      }),
      (error) => {
        expectRescheduleErrorCode(error, bookingRescheduleErrorCodes.invalidDateTime);
        return true;
      },
    );
  });
});
