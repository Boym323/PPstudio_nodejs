import {
  BookingActionTokenType,
  BookingActorType,
  BookingStatus,
  EmailAudience,
  EmailLogStatus,
  EmailLogType,
  Prisma,
  VoucherType,
  AvailabilitySlotStatus,
} from "@/generated/prisma/client";

import { env } from "@/config/env";
import {
  canApplyAdminBookingTransition,
  canCompleteBookingAt,
  canMarkBookingNoShowAt,
  type AdminBookingActionValue,
} from "@/features/booking/domain/booking-status-transition";
import {
  buildBookingActionToken,
  buildBookingCancellationUrl,
  buildBookingManagementUrl,
  buildBookingSelfServiceActionExpiry,
} from "@/features/booking/lib/booking-action-tokens";
import { resolveBookingTimingSnapshot } from "@/features/booking/lib/booking-cleanup";
import { canPreserveAutoLunchForBooking } from "@/features/booking/lib/booking-auto-lunch-enforcement";
import {
  archiveOrphanedManualOverrideSlotAfterCancellation,
  compactAdjacentEditableSlotsForBooking,
  preparePublishedAvailabilityForManualOverride,
  restoreArchivedAvailabilityAfterManualOverrideShortening,
} from "@/features/booking/lib/booking-slot-compaction";
import { resolvePublishedSlotCoverage } from "@/features/booking/lib/booking-slot-availability";
import { getBookingPaymentSummary } from "@/features/booking/payments/lib/booking-payment-summary";
import {
  enqueueBookingReminder24hForBooking,
  getBookingReminder24hEnqueueWindowPosition,
} from "@/features/booking/lib/booking-reminders";
import { scrubSensitiveEmailPayload } from "@/lib/email/payload-security";
import {
  ActiveClientDeliveryLeaseError,
  advanceBookingCommunicationGeneration,
  assertNoActiveClientDeliveryLease,
} from "@/lib/email/booking-delivery-fence";
import { runSerializableTransaction } from "@/lib/serializable-transaction";

export {
  canApplyAdminBookingTransition,
  canCompleteBookingAt,
  canMarkBookingNoShowAt,
  NO_SHOW_GRACE_MINUTES,
  type AdminBookingActionValue,
} from "@/features/booking/domain/booking-status-transition";
export {
  buildBookingCleanupMetadata,
  getAdminBookingActionOptions,
  getAdminBookingHref,
  getAdminBookingPaymentStatusLabel,
  getBookingAcquisitionLabel,
  getBookingSourceLabel,
  type AdminBookingActionOption,
  type AdminBookingPaymentStatus,
} from "@/features/admin/lib/booking/booking-display";
export { getBookingStatusLabel } from "@/features/booking/lib/booking-status-presentation";
export {
  getAdminBookingDetailData,
  type AdminBookingDetailData,
} from "@/features/admin/lib/booking/booking-detail";

type ApplyAdminBookingStatusChangeInput = {
  bookingId: string;
  targetStatus: AdminBookingActionValue;
  actorUserId: string | null;
  notifyClient: boolean;
  reason?: string;
  internalNote?: string;
  now?: Date;
};

type UpdateAdminBookingServiceInput = {
  bookingId: string;
  serviceId: string;
  actorUserId: string | null;
  expectedUpdatedAt?: string;
  reason?: string | null;
  now?: Date;
};

export async function applyAdminBookingStatusChange({
  bookingId,
  targetStatus,
  actorUserId,
  notifyClient,
  reason,
  internalNote,
  now,
}: ApplyAdminBookingStatusChangeInput) {
  return runSerializableTransaction((tx) => applyAdminBookingStatusChangeInTransaction(tx, {
      bookingId,
      targetStatus,
      actorUserId,
      notifyClient,
      reason,
      internalNote,
      now,
    }));
}
export async function applyAdminBookingStatusChangeInTransaction(
  tx: Prisma.TransactionClient,
  {
    bookingId,
    targetStatus,
    actorUserId,
    notifyClient,
    reason,
    internalNote,
    now: inputNow,
  }: ApplyAdminBookingStatusChangeInput,
) {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Booking"
      WHERE "id" = ${bookingId}
      FOR UPDATE
    `);

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        slotId: true,
        serviceId: true,
        manualOverride: true,
        clientNameSnapshot: true,
        clientEmailSnapshot: true,
        communicationGeneration: true,
        clientDeliveryLeaseToken: true,
        clientDeliveryLeaseExpiresAt: true,
        serviceNameSnapshot: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        reminder24hSentAt: true,
        voucherRedemptions: {
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!booking) {
      return { status: "not-found" as const };
    }

    const clientEmail = booking.clientEmailSnapshot?.trim() ?? "";

    if (!canApplyAdminBookingTransition(booking.status, targetStatus)) {
      return {
        status: "invalid-transition" as const,
        currentStatus: booking.status,
      };
    }

    const now = inputNow ?? new Date();

    try {
      assertNoActiveClientDeliveryLease(booking, now);
    } catch (error) {
      if (error instanceof ActiveClientDeliveryLeaseError) {
        return { status: "concurrent-modification" as const };
      }

      throw error;
    }

    const nextCommunicationGeneration = advanceBookingCommunicationGeneration(booking);

    if (
      (targetStatus === BookingStatus.CANCELLED || targetStatus === BookingStatus.NO_SHOW)
      && booking.voucherRedemptions.length > 0
    ) {
      return {
        status: "voucher-redemption-blocked" as const,
        currentStatus: booking.status,
      };
    }

    if (targetStatus === BookingStatus.COMPLETED && !canCompleteBookingAt(booking.scheduledEndsAt, now)) {
      return {
        status: "completion-too-early" as const,
        scheduledEndsAt: booking.scheduledEndsAt,
      };
    }

    if (targetStatus === BookingStatus.NO_SHOW && !canMarkBookingNoShowAt(booking.scheduledStartsAt, now)) {
      return {
        status: "no-show-too-early" as const,
        scheduledStartsAt: booking.scheduledStartsAt,
      };
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: targetStatus,
        confirmedAt: targetStatus === BookingStatus.CONFIRMED ? now : undefined,
        cancelledAt: targetStatus === BookingStatus.CANCELLED ? now : undefined,
        completedAt: targetStatus === BookingStatus.COMPLETED ? now : undefined,
        communicationGeneration: nextCommunicationGeneration,
        internalNote: internalNote ? internalNote : undefined,
      },
    });

    if (targetStatus === BookingStatus.CANCELLED) {
      await compactAdjacentEditableSlotsForBooking(tx, booking.slotId);

      if (booking.manualOverride) {
        await archiveOrphanedManualOverrideSlotAfterCancellation(tx, booking.slotId);
      }

      await tx.bookingActionToken.updateMany({
        where: {
          bookingId: booking.id,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    }

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        status: targetStatus,
        actorType: BookingActorType.USER,
        actorUserId,
        reason: reason || null,
        note: internalNote || null,
        metadata: {
          source: "admin-booking-detail-v2",
          fromStatus: booking.status,
          toStatus: targetStatus,
        },
      },
    });

    if (targetStatus === BookingStatus.CONFIRMED && clientEmail.length > 0) {
      const manageToken = buildBookingActionToken();
      const cancellationToken = buildBookingActionToken();

      await tx.bookingActionToken.create({
        data: {
          bookingId: booking.id,
          type: BookingActionTokenType.RESCHEDULE,
          tokenHash: manageToken.tokenHash,
          expiresAt: buildBookingSelfServiceActionExpiry(booking.scheduledStartsAt),
          lastSentAt: now,
        },
      });
      await tx.bookingActionToken.create({
        data: {
          bookingId: booking.id,
          type: BookingActionTokenType.CANCEL,
          tokenHash: cancellationToken.tokenHash,
          expiresAt: buildBookingSelfServiceActionExpiry(booking.scheduledStartsAt),
          lastSentAt: now,
        },
      });

      const clientPayload = {
        bookingId: booking.id,
        serviceId: booking.serviceId,
        serviceName: booking.serviceNameSnapshot,
        clientName: booking.clientNameSnapshot,
        scheduledStartsAt: booking.scheduledStartsAt.toISOString(),
        scheduledEndsAt: booking.scheduledEndsAt.toISOString(),
        manageReservationUrl: buildBookingManagementUrl(manageToken.rawToken),
        cancellationUrl: buildBookingCancellationUrl(cancellationToken.rawToken),
      };

      await tx.emailLog.create({
        data: {
          bookingId: booking.id,
          clientId: booking.clientId,
          type: EmailLogType.BOOKING_CONFIRMED,
          audience: EmailAudience.CLIENT,
          status: env.EMAIL_DELIVERY_MODE === "background" ? undefined : EmailLogStatus.SENT,
          attemptCount: env.EMAIL_DELIVERY_MODE === "background" ? undefined : 1,
          nextAttemptAt: env.EMAIL_DELIVERY_MODE === "background" ? now : undefined,
          processingStartedAt: null,
          processingToken: null,
          communicationGeneration: nextCommunicationGeneration,
          recipientEmail: clientEmail,
          subject: `Rezervace potvrzena: ${booking.serviceNameSnapshot}`,
          templateKey: "booking-approved-v1",
          payload: env.EMAIL_DELIVERY_MODE === "background"
            ? clientPayload
            : scrubSensitiveEmailPayload(clientPayload),
          provider: env.EMAIL_DELIVERY_MODE === "background" ? undefined : "log",
          sentAt: env.EMAIL_DELIVERY_MODE === "background" ? undefined : now,
        },
      });

      if (booking.reminder24hSentAt === null) {
        await enqueueBookingReminder24hForBooking(tx, {
          id: booking.id,
          clientId: booking.clientId,
          clientEmailSnapshot: clientEmail,
          communicationGeneration: nextCommunicationGeneration,
          clientNameSnapshot: booking.clientNameSnapshot,
          status: BookingStatus.CONFIRMED,
          serviceId: booking.serviceId,
          serviceNameSnapshot: booking.serviceNameSnapshot,
          scheduledStartsAt: booking.scheduledStartsAt,
          scheduledEndsAt: booking.scheduledEndsAt,
        }, now);
      }
    }

    if (
      targetStatus === BookingStatus.CANCELLED
      && notifyClient
      && clientEmail.length > 0
    ) {
      const clientPayload = {
        bookingId: booking.id,
        serviceId: booking.serviceId,
        serviceName: booking.serviceNameSnapshot,
        clientName: booking.clientNameSnapshot,
        scheduledStartsAt: booking.scheduledStartsAt.toISOString(),
        scheduledEndsAt: booking.scheduledEndsAt.toISOString(),
      };

      await tx.emailLog.create({
        data: {
          bookingId: booking.id,
          clientId: booking.clientId,
          type: EmailLogType.BOOKING_CANCELLED,
          audience: EmailAudience.CLIENT,
          status: env.EMAIL_DELIVERY_MODE === "background" ? undefined : EmailLogStatus.SENT,
          attemptCount: env.EMAIL_DELIVERY_MODE === "background" ? undefined : 1,
          nextAttemptAt: env.EMAIL_DELIVERY_MODE === "background" ? now : undefined,
          processingStartedAt: null,
          processingToken: null,
          communicationGeneration: nextCommunicationGeneration,
          recipientEmail: clientEmail,
          subject: `Storno potvrzeno: ${booking.serviceNameSnapshot}`,
          templateKey: "booking-cancelled-v1",
          payload: env.EMAIL_DELIVERY_MODE === "background"
            ? clientPayload
            : scrubSensitiveEmailPayload(clientPayload),
          provider: env.EMAIL_DELIVERY_MODE === "background" ? undefined : "log",
          sentAt: env.EMAIL_DELIVERY_MODE === "background" ? undefined : now,
        },
      });
    }

    return { status: "success" as const };
}

export async function updateAdminBookingInternalNote({
  bookingId,
  actorUserId,
  expectedUpdatedAt,
  internalNote,
}: {
  bookingId: string;
  actorUserId: string | null;
  expectedUpdatedAt: string;
  internalNote: string | null;
}) {
  return runSerializableTransaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "Booking"
      WHERE "id" = ${bookingId}
      FOR UPDATE
    `);

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });

    if (!booking) {
      return { status: "not-found" as const };
    }

    const expectedDate = new Date(expectedUpdatedAt);
    if (Number.isNaN(expectedDate.getTime()) || expectedDate.getTime() !== booking.updatedAt.getTime()) {
      return { status: "concurrent-modification" as const };
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        internalNote,
      },
    });

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        status: booking.status,
        actorType: BookingActorType.USER,
        actorUserId,
        reason: internalNote ? "Interní poznámka upravena" : "Interní poznámka odstraněna",
        note: internalNote,
        metadata: {
          source: "admin-booking-note-v1",
        },
      },
    });

    return { status: "success" as const };
  });
}

type UpdateAdminBookingPriceInput = {
  bookingId: string;
  actorUserId: string | null;
  expectedUpdatedAt: string;
  nextFinalPriceCzk: number | null;
  normalizedReason: string;
  confirmOverpayment: boolean;
};

export async function updateAdminBookingPrice(input: UpdateAdminBookingPriceInput) {
  return runSerializableTransaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Booking" WHERE "id" = ${input.bookingId} FOR UPDATE
    `);
    const currentBooking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        clientId: true,
        status: true,
        servicePriceFromCzk: true,
        finalPriceCzk: true,
        priceAdjustmentReason: true,
        priceAdjustedAt: true,
        priceAdjustedByUserId: true,
        updatedAt: true,
        service: { select: { priceFromCzk: true } },
        voucherRedemptions: { select: { amountCzk: true } },
        payments: { select: { amountCzk: true, status: true } },
      },
    });

    if (!currentBooking) return { status: "not-found" as const };

    const expectedDate = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedDate.getTime()) || expectedDate.getTime() !== currentBooking.updatedAt.getTime()) {
      return { status: "concurrent-modification" as const };
    }

    const basePriceCzk = Math.max(0, currentBooking.servicePriceFromCzk ?? currentBooking.service.priceFromCzk ?? 0);
    const clearsAdjustment = input.nextFinalPriceCzk === null || input.nextFinalPriceCzk === basePriceCzk;
    if (!clearsAdjustment && input.normalizedReason.length === 0) {
      return { status: "reason-required" as const };
    }

    const nextPaymentSummary = getBookingPaymentSummary({
      totalPriceCzk: clearsAdjustment ? basePriceCzk : input.nextFinalPriceCzk,
      voucherRedemptions: currentBooking.voucherRedemptions,
      payments: currentBooking.payments,
    });
    if (nextPaymentSummary.overpaidCzk > 0 && !input.confirmOverpayment) {
      return { status: "overpayment-confirmation-required" as const, overpaidCzk: nextPaymentSummary.overpaidCzk };
    }

    const nextStoredPrice = clearsAdjustment ? null : input.nextFinalPriceCzk;
    const nextStoredReason = clearsAdjustment ? null : input.normalizedReason;
    if (
      currentBooking.finalPriceCzk === nextStoredPrice
      && currentBooking.priceAdjustmentReason === nextStoredReason
    ) return { status: "unchanged" as const, bookingId: currentBooking.id, clientId: currentBooking.clientId, clearsAdjustment };

    const changedAt = new Date();
    await tx.booking.update({
      where: { id: currentBooking.id },
      data: clearsAdjustment
        ? {
            finalPriceCzk: null,
            priceAdjustmentReason: null,
            priceAdjustedAt: null,
            priceAdjustedByUserId: null,
          }
        : {
            finalPriceCzk: input.nextFinalPriceCzk,
            priceAdjustmentReason: input.normalizedReason,
            priceAdjustedAt: changedAt,
            priceAdjustedByUserId: input.actorUserId,
          },
    });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: currentBooking.id,
        status: currentBooking.status,
        actorType: BookingActorType.USER,
        actorUserId: input.actorUserId,
        reason: clearsAdjustment ? "Individuální cena zrušena" : "Individuální cena upravena",
        metadata: {
          source: "admin-booking-price-update-v1",
          before: {
            finalPriceCzk: currentBooking.finalPriceCzk,
            priceAdjustmentReason: currentBooking.priceAdjustmentReason,
            priceAdjustedAt: currentBooking.priceAdjustedAt?.toISOString() ?? null,
            priceAdjustedByUserId: currentBooking.priceAdjustedByUserId,
          },
          after: {
            finalPriceCzk: nextStoredPrice,
            priceAdjustmentReason: nextStoredReason,
            priceAdjustedAt: clearsAdjustment ? null : changedAt.toISOString(),
            priceAdjustedByUserId: clearsAdjustment ? null : input.actorUserId,
          },
        },
      },
    });
    return { status: "updated" as const, bookingId: currentBooking.id, clientId: currentBooking.clientId, clearsAdjustment };
  });
}

export async function updateAdminBookingService({
  bookingId,
  serviceId,
  actorUserId,
  expectedUpdatedAt,
  reason,
  now: inputNow,
}: UpdateAdminBookingServiceInput) {
  return runSerializableTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Booking"
      WHERE "id" = ${bookingId}
      FOR UPDATE
    `);

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        clientEmailSnapshot: true,
        clientNameSnapshot: true,
        status: true,
        slotId: true,
        serviceId: true,
        serviceNameSnapshot: true,
        serviceDurationMinutes: true,
        cleanupMinutes: true,
        cleanupBlockMinutes: true,
        servicePriceFromCzk: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        blockedUntil: true,
        manualOverride: true,
        finalPriceCzk: true,
        intendedVoucherId: true,
        reminder24hSentAt: true,
        communicationGeneration: true,
        clientDeliveryLeaseToken: true,
        clientDeliveryLeaseExpiresAt: true,
        updatedAt: true,
      },
    });

    if (!booking) {
      return { status: "not-found" as const };
    }

    try {
      assertNoActiveClientDeliveryLease(booking, inputNow ?? new Date());
    } catch (error) {
      if (error instanceof ActiveClientDeliveryLeaseError) {
        return { status: "concurrent-modification" as const };
      }

      throw error;
    }

    if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
      return {
        status: "status-not-allowed" as const,
        currentStatus: booking.status,
      };
    }

    if (expectedUpdatedAt) {
      const expectedDate = new Date(expectedUpdatedAt);

      if (!Number.isNaN(expectedDate.getTime()) && expectedDate.getTime() !== booking.updatedAt.getTime()) {
        return {
          status: "concurrent-modification" as const,
        };
      }
    }

    if (booking.serviceId === serviceId) {
      return { status: "same-service" as const };
    }

    const nextService = await tx.service.findFirst({
      where: {
        id: serviceId,
        isActive: true,
        isPubliclyBookable: true,
      },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        cleanupMinutes: true,
        priceFromCzk: true,
      },
    });

    if (!nextService) {
      return { status: "service-not-found" as const };
    }

    const nextTiming = resolveBookingTimingSnapshot({
      startsAt: booking.scheduledStartsAt,
      serviceDurationMinutes: nextService.durationMinutes,
      cleanupMinutes: nextService.cleanupMinutes,
    });
    const nextScheduledEndsAt = nextTiming.serviceEnd;
    const nextBlockedUntil = nextTiming.blockedUntil;
    const now = inputNow ?? new Date();
    const reminderWindowPosition = getBookingReminder24hEnqueueWindowPosition(
      booking.scheduledStartsAt,
      now,
    );
    const shouldEnqueueReplacementReminder = (
      booking.status === BookingStatus.CONFIRMED
      && booking.reminder24hSentAt === null
      && reminderWindowPosition !== "before"
    );
    const oldBlockedUntil = booking.blockedUntil ?? booking.scheduledEndsAt;
    const lifecycleRangeEnd = new Date(Math.max(oldBlockedUntil.getTime(), nextBlockedUntil.getTime()));

    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "AvailabilitySlot"
      WHERE "id" = ${booking.slotId}
         OR (
           "startsAt" < ${lifecycleRangeEnd}
           AND "endsAt" > ${booking.scheduledStartsAt}
         )
      FOR UPDATE
    `);

    const slot = await tx.availabilitySlot.findUniqueOrThrow({
      where: {
        id: booking.slotId,
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        status: true,
        publicNote: true,
        internalNote: true,
        serviceRestrictionMode: true,
        publishedAt: true,
        cancelledAt: true,
        createdByUserId: true,
        allowedServices: {
          select: {
            serviceId: true,
          },
        },
      },
    });

    const intendedVoucher = booking.intendedVoucherId
      ? await tx.voucher.findUnique({
          where: {
            id: booking.intendedVoucherId,
          },
          select: {
            id: true,
            type: true,
            serviceId: true,
          },
        })
      : null;

    const voucherRedemptions = await tx.voucherRedemption.findMany({
      where: {
        bookingId: booking.id,
      },
      select: {
        id: true,
        serviceId: true,
      },
    });

    if (
      intendedVoucher?.type === VoucherType.SERVICE
      && intendedVoucher.serviceId
      && intendedVoucher.serviceId !== nextService.id
    ) {
      return {
        status: "voucher-conflict" as const,
        message: "Na rezervaci je navázaný službový voucher pro jinou službu. Nejprve upravte nebo odeberte voucher.",
      };
    }

    const conflictingRedemption = voucherRedemptions.some(
      (redemption) => redemption.serviceId && redemption.serviceId !== nextService.id,
    );

    if (conflictingRedemption) {
      return {
        status: "voucher-conflict" as const,
        message: "Na rezervaci už je uplatněný službový voucher pro jinou službu. Změnu služby proto nepovolíme.",
      };
    }

    const overlappingSlots = await tx.availabilitySlot.findMany({
      where: {
        id: {
          not: booking.slotId,
        },
        startsAt: {
          lt: nextScheduledEndsAt,
        },
        endsAt: {
          gt: booking.scheduledStartsAt,
        },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        status: true,
        publicNote: true,
        internalNote: true,
        serviceRestrictionMode: true,
        publishedAt: true,
        cancelledAt: true,
        createdByUserId: true,
        allowedServices: {
          select: {
            serviceId: true,
          },
        },
      },
      orderBy: [{ startsAt: "asc" }],
    });

    const manualOverrideResizeSlots = booking.manualOverride
      ? await tx.availabilitySlot.findMany({
          where: {
            id: {
              not: booking.slotId,
            },
            startsAt: {
              lt: lifecycleRangeEnd,
            },
            endsAt: {
              gt: booking.scheduledStartsAt,
            },
            status: {
              in: [
                AvailabilitySlotStatus.DRAFT,
                AvailabilitySlotStatus.PUBLISHED,
                AvailabilitySlotStatus.ARCHIVED,
              ],
            },
          },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            capacity: true,
            status: true,
            publicNote: true,
            internalNote: true,
            serviceRestrictionMode: true,
            publishedAt: true,
            cancelledAt: true,
            createdByUserId: true,
            allowedServices: {
              select: {
                serviceId: true,
              },
            },
          },
          orderBy: [{ startsAt: "asc" }],
        })
      : [];

    const publishedCoverage = resolvePublishedSlotCoverage(
      [slot, ...overlappingSlots],
      nextService.id,
      booking.scheduledStartsAt,
      nextScheduledEndsAt,
      slot.id,
    );

    const slotAllowsNewService = slot.serviceRestrictionMode === "ANY"
      || slot.allowedServices.some((allowedService) => allowedService.serviceId === nextService.id);
    const currentSlotCoversExistingTiming =
      booking.scheduledStartsAt.getTime() >= slot.startsAt.getTime()
      && oldBlockedUntil.getTime() <= slot.endsAt.getTime();
    const currentSlotCoversNewTiming =
      booking.scheduledStartsAt.getTime() >= slot.startsAt.getTime()
      && nextBlockedUntil.getTime() <= slot.endsAt.getTime();
    const isManualOverrideDraftResize = booking.manualOverride
      && slot.status === AvailabilitySlotStatus.DRAFT
      && slotAllowsNewService
      && currentSlotCoversExistingTiming;

    const canStayOnManualOverrideSlot = booking.manualOverride
      && slot.status !== "PUBLISHED"
      && slotAllowsNewService
      && (currentSlotCoversNewTiming || isManualOverrideDraftResize);

    if (!publishedCoverage && !canStayOnManualOverrideSlot) {
      return {
        status: "slot-too-short" as const,
      };
    }

    const activeBookingCount = await tx.booking.count({
      where: {
        id: {
          not: booking.id,
        },
        status: {
          in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
        },
        scheduledStartsAt: {
          lt: nextBlockedUntil,
        },
        blockedUntil: {
          gt: booking.scheduledStartsAt,
        },
      },
    });

    if (activeBookingCount > 0) {
      return { status: "conflict" as const };
    }

    const preservesAutoLunch = await canPreserveAutoLunchForBooking(tx, {
      requestedStartsAt: booking.scheduledStartsAt,
      requestedBlockedUntil: nextBlockedUntil,
      excludeBookingId: booking.id,
    });

    if (!preservesAutoLunch) {
      return { status: "slot-unavailable" as const };
    }

    const isManualOverrideShortening = isManualOverrideDraftResize
      && nextBlockedUntil.getTime() < oldBlockedUntil.getTime();
    const isManualOverrideExtension = isManualOverrideDraftResize
      && nextBlockedUntil.getTime() > oldBlockedUntil.getTime();

    if (isManualOverrideExtension) {
      const protectedDraftOverlap = manualOverrideResizeSlots.some((candidate) => (
        candidate.status === AvailabilitySlotStatus.DRAFT
        && candidate.startsAt < nextBlockedUntil
        && candidate.endsAt > oldBlockedUntil
      ));

      if (protectedDraftOverlap) {
        return { status: "conflict" as const };
      }

      const manualOverridePreparation = await preparePublishedAvailabilityForManualOverride(
        tx,
        manualOverrideResizeSlots.filter((candidate) => candidate.status === AvailabilitySlotStatus.PUBLISHED),
        oldBlockedUntil,
        nextBlockedUntil,
        booking.id,
      );

      if (manualOverridePreparation.protectedSlotIds.length > 0) {
        return { status: "conflict" as const };
      }
    }

    if (slot.status !== "PUBLISHED") {
      await tx.availabilitySlot.update({
        where: {
          id: slot.id,
        },
        data: {
          endsAt: nextBlockedUntil,
        },
      });
    }

    if (isManualOverrideShortening) {
      await restoreArchivedAvailabilityAfterManualOverrideShortening(
        tx,
        slot.id,
        nextBlockedUntil,
        oldBlockedUntil,
      );
    }

    await tx.booking.update({
      where: {
        id: booking.id,
      },
      data: {
        serviceId: nextService.id,
        serviceNameSnapshot: nextService.name,
        serviceDurationMinutes: nextTiming.serviceDurationMinutes,
        cleanupMinutes: nextTiming.cleanupMinutes,
        cleanupBlockMinutes: nextTiming.cleanupBlockMinutes,
        servicePriceFromCzk: nextService.priceFromCzk,
        scheduledEndsAt: nextScheduledEndsAt,
        blockedUntil: nextBlockedUntil,
        communicationGeneration: { increment: 1 },
        reminder24hQueuedAt: booking.reminder24hSentAt === null ? null : undefined,
      },
    });

    if (shouldEnqueueReplacementReminder) {
      await enqueueBookingReminder24hForBooking(tx, {
        id: booking.id,
        clientId: booking.clientId,
        clientEmailSnapshot: booking.clientEmailSnapshot,
        communicationGeneration: booking.communicationGeneration + 1,
        clientNameSnapshot: booking.clientNameSnapshot,
        status: booking.status,
        serviceId: nextService.id,
        serviceNameSnapshot: nextService.name,
        scheduledStartsAt: booking.scheduledStartsAt,
        scheduledEndsAt: nextScheduledEndsAt,
      }, now);
    }

    const normalizedReason = reason?.trim() ? reason.trim() : null;
    const metadata = {
      source: "admin-booking-service-change-v1",
      previousServiceId: booking.serviceId,
      previousServiceName: booking.serviceNameSnapshot,
      previousDurationMinutes: booking.serviceDurationMinutes,
      previousCleanupBlockMinutes: booking.cleanupBlockMinutes,
      previousScheduledEndsAt: booking.scheduledEndsAt.toISOString(),
      nextServiceId: nextService.id,
      nextServiceName: nextService.name,
      nextDurationMinutes: nextTiming.serviceDurationMinutes,
      nextCleanupBlockMinutes: nextTiming.cleanupBlockMinutes,
      nextScheduledEndsAt: nextScheduledEndsAt.toISOString(),
      keptFinalPriceCzk: booking.finalPriceCzk,
    };

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        status: booking.status,
        actorType: BookingActorType.USER,
        actorUserId,
        reason: normalizedReason
          ? `Služba změněna: ${booking.serviceNameSnapshot} -> ${nextService.name}. ${normalizedReason}`
          : `Služba změněna: ${booking.serviceNameSnapshot} -> ${nextService.name}.`,
        note: null,
        metadata,
      },
    });

    return {
      status: "success" as const,
      clientId: booking.clientId,
      previousServiceName: booking.serviceNameSnapshot,
      nextServiceName: nextService.name,
      previousScheduledEndsAt: booking.scheduledEndsAt,
      nextScheduledEndsAt,
      previousCleanupBlockMinutes: booking.cleanupBlockMinutes,
      nextCleanupBlockMinutes: nextTiming.cleanupBlockMinutes,
      keptFinalPriceCzk: booking.finalPriceCzk,
    };
  });
}
