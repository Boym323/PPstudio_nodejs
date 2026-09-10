import {
  BookingPaymentStatus as BookingPaymentRecordStatus,
  AdminRole,
  BookingActorType,
  BookingPaymentMethod,
  BookingStatus,
  VoucherStatus,
  VoucherType,
} from "@/generated/prisma/client";

import { type AdminArea } from "@/config/navigation";
import {
  buildBookingCleanupMetadata,
  formatAdminBookingDateLabel,
  formatDateTimeLabel,
  getAdminBookingActionOptions,
  getAdminBookingPaymentStatusLabel,
  getBookingAcquisitionLabel,
  getBookingSourceLabel,
  type AdminBookingActionOption,
  type AdminBookingPaymentStatus,
} from "@/features/admin/lib/booking/booking-display";
import { getBookingStatusLabel } from "@/features/booking/lib/booking-status-presentation";
import { getAdminBookingAvailabilityCatalog } from "@/features/booking/lib/booking-admin-availability";
import { formatBookingDateLabel } from "@/features/booking/lib/booking-format";
import { formatClientPhoneForDisplay } from "@/features/booking/lib/client-phone";
import {
  BOOKING_PAYMENT_METHOD_LABELS,
  getBookingPaymentSummary,
} from "@/features/booking/payments/lib/booking-payment-summary";
import {
  formatVoucherRemaining,
  formatVoucherStatus,
  formatVoucherType,
  formatVoucherValue,
  getEffectiveVoucherStatus,
} from "@/features/vouchers/lib/voucher-format";
import { prisma } from "@/lib/prisma";

export type AdminBookingDetailData = {
  id: string;
  area: AdminArea;
  title: string;
  status: BookingStatus;
  statusLabel: string;
  scheduledAtLabel: string;
  createdAtLabel: string;
  updatedAtLabel: string;
  clientName: string;
  clientId: string;
  clientEmail: string;
  clientPhone: string;
  serviceId: string;
  serviceName: string;
  availableServices: Array<{
    id: string;
    categoryName: string;
    name: string;
    durationMinutes: number;
    cleanupBlockMinutes: number;
    priceFromCzk: number | null;
  }>;
  servicePriceFromCzk: number | null;
  effectivePriceCzk: number;
  priceAdjustment: {
    finalPriceCzk: number | null;
    basePriceCzk: number;
    adjustmentCzk: number;
    reason: string | null;
    adjustedAtLabel: string | null;
    adjustedByUserLabel: string | null;
    canUpdate: boolean;
  };
  sourceLabel: string;
  acquisitionLabel: string | null;
  clientNote: string | null;
  internalNote: string | null;
  rescheduleCount: number;
  rescheduledAtLabel: string | null;
  cleanup: {
    cleanupBlockMinutes: number;
    cleanupLabel: string;
    blockedUntilLabel: string;
  };
  availableActions: AdminBookingActionOption[];
  historyItems: Array<{
    id: string;
    kind: "status" | "reschedule";
    badgeLabel: string;
    badgeTone: BookingStatus | "RESCHEDULED";
    description: string;
    actorLabel: string;
    createdAtLabel: string;
    reason: string | null;
    note: string | null;
    sourceLabel: string | null;
  }>;
  reschedule: {
    enabled: boolean;
    serviceId: string;
    serviceDurationMinutes: number;
    cleanupBlockMinutes: number;
    currentStartsAt: string;
    currentEndsAt: string;
    expectedUpdatedAt: string;
    slots: Awaited<ReturnType<typeof getAdminBookingAvailabilityCatalog>>["slots"];
    scheduleOptimization: Awaited<ReturnType<typeof getAdminBookingAvailabilityCatalog>>["scheduleOptimization"];
  };
  voucher: {
    paymentSummary: {
      totalPriceCzk: number | null;
      voucherPaidCzk: number;
      paidAmountCzk: number;
      remainingAmountCzk: number | null;
      paymentStatus: AdminBookingPaymentStatus;
      paymentStatusLabel: string;
      directPaidCzk: number;
      paidTotalCzk: number;
      remainingCzk: number;
      overpaidCzk: number;
      status: AdminBookingPaymentStatus;
      statusLabel: string;
    };
    payments: Array<{
      id: string;
      amountCzk: number;
      amountLabel: string;
      method: BookingPaymentMethod;
      methodLabel: string;
      paidAt: string;
      paidAtLabel: string;
      note: string | null;
      status: BookingPaymentRecordStatus;
      voidedAtLabel: string | null;
      voidReason: string | null;
      voidedByUserLabel: string | null;
      createdByUserLabel: string;
      createdAtLabel: string;
      updatedAt: string;
      lastEditedByUserLabel: string | null;
      lastEditedAtLabel: string | null;
      canEdit: boolean;
      canDelete: boolean;
    }>;
    intendedVoucherCodeSnapshot: string | null;
    intendedVoucherValidatedAtLabel: string | null;
    intendedVoucher: {
      id: string;
      code: string;
      type: VoucherType;
      typeLabel: string;
      status: VoucherStatus;
      effectiveStatus: VoucherStatus;
      statusLabel: string;
      valueLabel: string;
      remainingLabel: string;
      remainingValueCzk: number | null;
      serviceId: string | null;
      serviceNameSnapshot: string | null;
      servicePriceSnapshotCzk: number | null;
      safeDescription: string;
      defaultRedeemAmountCzk: number | null;
    } | null;
    redemptions: Array<{
      id: string;
      voucherCode: string;
      voucherType: VoucherType;
      voucherTypeLabel: string;
      amountCzk: number | null;
      serviceNameSnapshot: string | null;
      redeemedAtLabel: string;
      redeemedByUserLabel: string;
      note: string | null;
    }>;
  };
};

function getActorLabel(actorType: BookingActorType, actorName?: string | null): string {
  switch (actorType) {
    case BookingActorType.USER:
      return actorName ? `Admin • ${actorName}` : "Admin";
    case BookingActorType.CLIENT:
      return "Klientka";
    case BookingActorType.SYSTEM:
      return "Systém";
  }

  return String(actorType);
}

function getHistorySourceLabel(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const source = "source" in metadata ? metadata.source : null;

  switch (source) {
    case "admin-booking-detail-v1":
      return "Původní detail";
    case "admin-booking-detail-v2":
      return "Akce detailu";
    case "admin-booking-note-v1":
      return "Interní poznámka";
    case "admin-booking-complete-flow-v1":
      return "Dokončení návštěvy";
    case "admin-manual-booking-v1":
      return "Ruční vytvoření";
    case "public-booking-request-v1":
      return "Veřejný booking";
    default:
      return null;
  }
}

function formatRedemptionUserLabel(user: { name: string; email: string } | null) {
  if (!user) {
    return "Neuvedeno";
  }

  return `${user.name} (${user.email})`;
}

function buildVoucherSafeDescription(voucher: {
  type: VoucherType;
  originalValueCzk: number | null;
  remainingValueCzk: number | null;
  serviceNameSnapshot: string | null;
  servicePriceSnapshotCzk: number | null;
}) {
  if (voucher.type === VoucherType.VALUE) {
    return `Hodnotový voucher, zbývá ${formatVoucherRemaining({
      type: voucher.type,
      remainingValueCzk: voucher.remainingValueCzk,
      status: VoucherStatus.ACTIVE,
    })}.`;
  }

  return `Voucher na službu ${voucher.serviceNameSnapshot ?? "bez uloženého názvu"}${
    voucher.servicePriceSnapshotCzk ? ` v hodnotě ${czkFormatter.format(voucher.servicePriceSnapshotCzk)}` : ""
  }.`;
}

const czkFormatter = new Intl.NumberFormat("cs-CZ", {
  maximumFractionDigits: 0,
  style: "currency",
  currency: "CZK",
});

function formatCzk(value: number | null | undefined) {
  return czkFormatter.format(value ?? 0);
}

function buildPaymentSummary({
  totalPriceCzk,
  voucherPaidCzk,
  directPaidCzk,
}: {
  totalPriceCzk: number;
  voucherPaidCzk: number;
  directPaidCzk: number;
}): AdminBookingDetailData["voucher"]["paymentSummary"] {
  const summary = getBookingPaymentSummary({
    totalPriceCzk,
    voucherRedemptions: [{ amountCzk: voucherPaidCzk }],
    payments: [{ amountCzk: directPaidCzk }],
  });

  return {
    totalPriceCzk: summary.totalPriceCzk,
    voucherPaidCzk: summary.voucherPaidCzk,
    paidAmountCzk: summary.paidTotalCzk,
    remainingAmountCzk: summary.remainingCzk,
    paymentStatus: summary.status,
    paymentStatusLabel: getAdminBookingPaymentStatusLabel(summary.status),
    directPaidCzk: summary.directPaidCzk,
    paidTotalCzk: summary.paidTotalCzk,
    remainingCzk: summary.remainingCzk,
    overpaidCzk: summary.overpaidCzk,
    status: summary.status,
    statusLabel: getAdminBookingPaymentStatusLabel(summary.status),
  };
}
export async function getAdminBookingDetailData(
  area: AdminArea,
  bookingId: string,
): Promise<AdminBookingDetailData | null> {
  const now = new Date();
  const [booking, bookingCatalog] = await Promise.all([
    prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: {
          select: {
            fullName: true,
            email: true,
            phone: true,
          },
        },
        service: {
          select: {
            priceFromCzk: true,
            category: {
              select: {
                name: true,
              },
            },
          },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
          include: {
            actorUser: {
              select: { name: true },
            },
          },
        },
        rescheduleLogs: {
          orderBy: { createdAt: "desc" },
          include: {
            changedByUser: {
              select: {
                name: true,
              },
            },
          },
        },
        intendedVoucher: {
          select: {
            id: true,
            code: true,
            type: true,
            status: true,
            originalValueCzk: true,
            remainingValueCzk: true,
            serviceId: true,
            serviceNameSnapshot: true,
            servicePriceSnapshotCzk: true,
            validUntil: true,
          },
        },
        voucherRedemptions: {
          orderBy: { redeemedAt: "desc" },
          include: {
            voucher: {
              select: {
                code: true,
                type: true,
              },
            },
            redeemedByUser: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        payments: {
          orderBy: {
            paidAt: "desc",
          },
          include: {
            createdByUser: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
            voidedByUser: {
              select: {
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        priceAdjustedByUser: {
          select: {
            name: true,
            email: true,
            role: true,
          },
        },
      },
    }),
    getAdminBookingAvailabilityCatalog({
      includeServices: true,
      excludeBookingId: bookingId,
    }),
  ]);

  if (!booking) {
    return null;
  }

  const historyItems = [
    ...booking.statusHistory.map((historyItem) => ({
      id: historyItem.id,
      kind: "status" as const,
      badgeLabel: getBookingStatusLabel(historyItem.status),
      badgeTone: historyItem.status,
      description: `Stav rezervace je „${getBookingStatusLabel(historyItem.status)}“.`,
      actorLabel: getActorLabel(historyItem.actorType, historyItem.actorUser?.name),
      createdAtLabel: formatDateTimeLabel(historyItem.createdAt),
      reason: historyItem.reason,
      note: historyItem.note,
      sourceLabel: getHistorySourceLabel(historyItem.metadata),
      createdAt: historyItem.createdAt,
    })),
    ...booking.rescheduleLogs.map((log) => ({
      id: log.id,
      kind: "reschedule" as const,
      badgeLabel: "Přesun termínu",
      badgeTone: "RESCHEDULED" as const,
      description: `Z ${formatBookingDateLabel(log.oldStartAt, log.oldEndAt)} na ${formatBookingDateLabel(log.newStartAt, log.newEndAt)}.`,
      actorLabel: log.changedByClient ? "Klientka" : getActorLabel(BookingActorType.USER, log.changedByUser?.name),
      createdAtLabel: formatDateTimeLabel(log.createdAt),
      reason: log.reason,
      note: null,
      sourceLabel: "Doménová akce reschedule",
      createdAt: log.createdAt,
    })),
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const paymentLastEdits = new Map<string, { actorLabel: string; createdAtLabel: string }>();
  for (const historyItem of booking.statusHistory) {
    const metadata = historyItem.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const source = metadata.source;
    const paymentId = metadata.paymentId;
    if (source === "admin-booking-payment-update-v1" && typeof paymentId === "string" && !paymentLastEdits.has(paymentId)) {
      paymentLastEdits.set(paymentId, { actorLabel: historyItem.actorUser?.name ?? "Neuvedeno", createdAtLabel: formatDateTimeLabel(historyItem.createdAt) });
    }
  }
  const basePriceCzk = Math.max(0, booking.servicePriceFromCzk ?? booking.service.priceFromCzk ?? 0);
  const effectivePriceCzk = Math.max(0, booking.finalPriceCzk ?? basePriceCzk);
  const priceAdjustmentCzk = effectivePriceCzk - basePriceCzk;
  const voucherPaidCzk = booking.voucherRedemptions.reduce(
    (total, redemption) => total + (redemption.amountCzk ?? 0),
    0,
  );
  const directPaidCzk = booking.payments.reduce(
    (total, payment) => total + (payment.status === BookingPaymentRecordStatus.VOIDED ? 0 : payment.amountCzk),
    0,
  );
  const paymentSummary = buildPaymentSummary({
    totalPriceCzk: effectivePriceCzk,
    voucherPaidCzk,
    directPaidCzk,
  });
  const clientPhone = booking.clientPhoneSnapshot ?? booking.client.phone;

  return {
    id: booking.id,
    area,
    title: `${booking.clientNameSnapshot} • ${booking.serviceNameSnapshot}`,
    status: booking.status,
    statusLabel: getBookingStatusLabel(booking.status),
    scheduledAtLabel: formatAdminBookingDateLabel(booking.scheduledStartsAt, booking.scheduledEndsAt),
    createdAtLabel: formatDateTimeLabel(booking.createdAt),
    updatedAtLabel: formatDateTimeLabel(booking.updatedAt),
    clientName: booking.client.fullName,
    clientId: booking.clientId,
    clientEmail: booking.clientEmailSnapshot.trim(),
    clientPhone: clientPhone ? formatClientPhoneForDisplay(clientPhone) : "Telefon není vyplněný",
    serviceId: booking.serviceId,
    serviceName: booking.serviceNameSnapshot,
    availableServices: [
      ...(!bookingCatalog.services.some((service) => service.id === booking.serviceId)
        ? [{
            id: booking.serviceId,
            categoryName: booking.service.category?.name ?? "Aktuální služba",
            name: booking.serviceNameSnapshot,
            durationMinutes: booking.serviceDurationMinutes,
            cleanupBlockMinutes: booking.cleanupBlockMinutes,
            priceFromCzk: booking.servicePriceFromCzk,
          }]
        : []),
      ...bookingCatalog.services.map((service) => ({
        id: service.id,
        categoryName: service.categoryName,
        name: service.name,
        durationMinutes: service.durationMinutes,
        cleanupBlockMinutes: service.cleanupBlockMinutes,
        priceFromCzk: service.priceFromCzk,
      })),
    ],
    servicePriceFromCzk: booking.servicePriceFromCzk,
    effectivePriceCzk,
    priceAdjustment: {
      finalPriceCzk: booking.finalPriceCzk,
      basePriceCzk,
      adjustmentCzk: priceAdjustmentCzk,
      reason: booking.priceAdjustmentReason,
      adjustedAtLabel: booking.priceAdjustedAt ? formatDateTimeLabel(booking.priceAdjustedAt) : null,
      adjustedByUserLabel: formatOptionalAdminUserLabel(booking.priceAdjustedByUser),
      canUpdate: true,
    },
    sourceLabel: getBookingSourceLabel(booking.source),
    acquisitionLabel: getBookingAcquisitionLabel(booking.acquisitionSource),
    clientNote: booking.clientNote,
    internalNote: booking.internalNote,
    rescheduleCount: booking.rescheduleCount,
    rescheduledAtLabel: booking.rescheduledAt ? formatDateTimeLabel(booking.rescheduledAt) : null,
    cleanup: buildBookingCleanupMetadata({
      cleanupBlockMinutes: booking.cleanupBlockMinutes,
      blockedUntil: booking.blockedUntil,
      scheduledEndsAt: booking.scheduledEndsAt,
    }),
    availableActions: getAdminBookingActionOptions(booking.status, {
      scheduledStartsAt: booking.scheduledStartsAt,
      scheduledEndsAt: booking.scheduledEndsAt,
    }),
    historyItems: historyItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      badgeLabel: item.badgeLabel,
      badgeTone: item.badgeTone,
      description: item.description,
      actorLabel: item.actorLabel,
      createdAtLabel: item.createdAtLabel,
      reason: item.reason,
      note: item.note,
      sourceLabel: item.sourceLabel,
    })),
    reschedule: {
      enabled: booking.status === BookingStatus.PENDING || booking.status === BookingStatus.CONFIRMED,
      serviceId: booking.serviceId,
      serviceDurationMinutes: booking.serviceDurationMinutes,
      cleanupBlockMinutes: booking.cleanupBlockMinutes,
      currentStartsAt: booking.scheduledStartsAt.toISOString(),
      currentEndsAt: booking.scheduledEndsAt.toISOString(),
      expectedUpdatedAt: booking.updatedAt.toISOString(),
      slots: bookingCatalog.slots,
      scheduleOptimization: bookingCatalog.scheduleOptimization,
    },
    voucher: {
      paymentSummary,
      payments: booking.payments.map((payment) => ({
        id: payment.id,
        amountCzk: payment.amountCzk,
        amountLabel: formatCzk(payment.amountCzk),
        method: payment.method,
        methodLabel: BOOKING_PAYMENT_METHOD_LABELS[payment.method],
        paidAt: payment.paidAt.toISOString(),
        paidAtLabel: formatDateTimeLabel(payment.paidAt),
        note: payment.note,
        status: payment.status,
        voidedAtLabel: payment.voidedAt ? formatDateTimeLabel(payment.voidedAt) : null,
        voidReason: payment.voidReason,
        voidedByUserLabel: formatOptionalAdminUserLabel(payment.voidedByUser),
        createdByUserLabel: formatBookingPaymentUserLabel(payment.createdByUser),
        createdAtLabel: formatDateTimeLabel(payment.createdAt),
        updatedAt: payment.updatedAt.toISOString(),
        lastEditedByUserLabel: paymentLastEdits.get(payment.id)?.actorLabel ?? null,
        lastEditedAtLabel: paymentLastEdits.get(payment.id)?.createdAtLabel ?? null,
        canEdit: payment.status === BookingPaymentRecordStatus.ACTIVE,
        canDelete: area === "owner" && payment.status === BookingPaymentRecordStatus.ACTIVE,
      })),
      intendedVoucherCodeSnapshot: booking.intendedVoucherCodeSnapshot,
      intendedVoucherValidatedAtLabel: booking.intendedVoucherValidatedAt
        ? formatDateTimeLabel(booking.intendedVoucherValidatedAt)
        : null,
      intendedVoucher: booking.intendedVoucher
        ? {
            id: booking.intendedVoucher.id,
            code: booking.intendedVoucher.code,
            type: booking.intendedVoucher.type,
            typeLabel: formatVoucherType(booking.intendedVoucher.type),
            status: booking.intendedVoucher.status,
            effectiveStatus: getEffectiveVoucherStatus(booking.intendedVoucher, now),
            statusLabel: formatVoucherStatus(getEffectiveVoucherStatus(booking.intendedVoucher, now)),
            valueLabel: formatVoucherValue(booking.intendedVoucher),
            remainingLabel: formatVoucherRemaining(booking.intendedVoucher),
            remainingValueCzk: booking.intendedVoucher.remainingValueCzk,
            serviceId: booking.intendedVoucher.serviceId,
            serviceNameSnapshot: booking.intendedVoucher.serviceNameSnapshot,
            servicePriceSnapshotCzk: booking.intendedVoucher.servicePriceSnapshotCzk,
            safeDescription: buildVoucherSafeDescription(booking.intendedVoucher),
            defaultRedeemAmountCzk:
              booking.intendedVoucher.type === VoucherType.VALUE
                ? Math.min(
                    booking.intendedVoucher.remainingValueCzk ?? 0,
                    paymentSummary.remainingAmountCzk ?? 0,
                  )
                : booking.intendedVoucher.servicePriceSnapshotCzk ?? effectivePriceCzk,
          }
        : null,
      redemptions: booking.voucherRedemptions.map((redemption) => ({
        id: redemption.id,
        voucherCode: redemption.voucher.code,
        voucherType: redemption.voucher.type,
        voucherTypeLabel: formatVoucherType(redemption.voucher.type),
        amountCzk: redemption.amountCzk,
        serviceNameSnapshot: redemption.serviceNameSnapshot,
        redeemedAtLabel: formatDateTimeLabel(redemption.redeemedAt),
        redeemedByUserLabel: formatRedemptionUserLabel(redemption.redeemedByUser),
        note: redemption.note,
      })),
    },
  };
}

function formatBookingPaymentUserLabel(
  user: { name: string; email: string; role: AdminRole } | null,
) {
  if (!user) {
    return "Neuvedeno";
  }

  return `${user.name} (${user.email})`;
}

function formatOptionalAdminUserLabel(
  user: { name: string; email: string; role: AdminRole } | null,
) {
  return user ? `${user.name} (${user.email})` : null;
}
