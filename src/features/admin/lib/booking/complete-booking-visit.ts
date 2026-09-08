import "server-only";

import {
  AdminRole,
  BookingActorType,
  BookingPaymentMethod,
  BookingStatus,
  Prisma,
} from "@/generated/prisma/client";

import { applyAdminBookingStatusChangeInTransaction } from "@/features/admin/lib/admin-booking";
import { getBookingStatusLabel } from "@/features/booking/lib/booking-status-presentation";
import {
  canApplyAdminBookingTransition,
  canCompleteBookingAt,
} from "@/features/booking/domain/booking-status-transition";
import { getBookingPaymentSummary } from "@/features/booking/payments/lib/booking-payment-summary";
import { createDirectBookingPayment } from "@/features/booking/payments/lib/booking-payment";
import {
  redeemVoucherForBookingInTransaction,
} from "@/features/vouchers/lib/voucher-redemption";

export class CompletionPaymentError extends Error {}

type CompleteBookingVisitTransactionInput = {
  bookingId: string;
  area: "owner" | "salon";
  sessionEmail: string;
  sessionRole: AdminRole;
  actorUserId: string | null;
  mode: "cash" | "qr" | "voucher" | "combined" | "no_payment" | "settled";
  baseReason?: string;
  note: string | null;
  voucherCode?: string;
  voucherAmountCzk?: number;
  directAmountCzk?: number;
  directMethod?: "CASH" | "BANK_TRANSFER";
  idempotencyKey: string;
};

/**
 * The complete flow is deliberately kept as one retryable transaction. The
 * booking and payment state are read again on every retry, so a retry never
 * reuses the snapshot from a failed serializable transaction.
 */
export async function completeBookingVisitInTransaction(
  tx: Prisma.TransactionClient,
  input: CompleteBookingVisitTransactionInput,
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Booking" WHERE "id" = ${input.bookingId} FOR UPDATE
  `);
  const current = await tx.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true, status: true, scheduledEndsAt: true, finalPriceCzk: true, servicePriceFromCzk: true,
      service: { select: { priceFromCzk: true } },
      voucherRedemptions: { select: { amountCzk: true } },
      payments: { select: { amountCzk: true, status: true } },
    },
  });
  if (!current) throw new CompletionPaymentError("Rezervaci se nepodařilo najít.");
  if (!canApplyAdminBookingTransition(current.status, BookingStatus.COMPLETED)) {
    throw new CompletionPaymentError(`Rezervaci ve stavu „${getBookingStatusLabel(current.status)}“ teď nejde dokončit.`);
  }
  if (!canCompleteBookingAt(current.scheduledEndsAt)) {
    throw new CompletionPaymentError("Rezervaci lze dokončit až po skončení naplánovaného termínu.");
  }

  const currentSummary = getBookingPaymentSummary({
    totalPriceCzk: current.finalPriceCzk ?? current.servicePriceFromCzk ?? current.service.priceFromCzk ?? 0,
    voucherRedemptions: current.voucherRedemptions,
    payments: current.payments,
  });
  if (currentSummary.remainingCzk > 0 && input.mode === "settled") {
    throw new CompletionPaymentError("Při doplatku je potřeba vybrat způsob úhrady nebo dokončení bez úhrady.");
  }

  if (input.mode === "cash" || input.mode === "qr" || input.mode === "combined") {
    const directMethod = input.mode === "cash" ? BookingPaymentMethod.CASH : input.mode === "qr"
      ? BookingPaymentMethod.BANK_TRANSFER
      : input.directMethod === "CASH" ? BookingPaymentMethod.CASH : BookingPaymentMethod.BANK_TRANSFER;
    const paymentResult = await createDirectBookingPayment(tx, {
      bookingId: current.id,
      amountCzk: input.directAmountCzk ?? currentSummary.remainingCzk,
      method: directMethod,
      paidAt: new Date(),
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      actor: { area: input.area, email: input.sessionEmail, role: input.sessionRole },
      audit: { reason: "Platba zapsána při dokončení návštěvy", source: "admin-booking-complete-flow-v1" },
    });
    if (paymentResult.status !== "created" && paymentResult.status !== "existing") {
      throw new CompletionPaymentError("Platbu se nepodařilo bezpečně zapsat.");
    }
  }

  let voucherId: string | null = null;
  let completionApplied = false;
  if (input.mode === "voucher" || input.mode === "combined") {
    const completion = await applyAdminBookingStatusChangeInTransaction(tx, {
      bookingId: current.id,
      targetStatus: BookingStatus.COMPLETED,
      actorUserId: input.actorUserId,
      notifyClient: false,
      reason: input.baseReason,
    });
    if (completion.status !== "success") throw new CompletionPaymentError("Stav rezervace se nepodařilo změnit.");
    completionApplied = true;

    const redemption = await redeemVoucherForBookingInTransaction(tx, {
      bookingId: current.id,
      voucherCode: input.voucherCode ?? "",
      amountCzk: input.voucherAmountCzk ?? (input.mode === "voucher" ? currentSummary.remainingCzk : undefined),
      redeemedByUserId: input.actorUserId,
      note: input.note ?? undefined,
    });
    voucherId = redemption.voucher.id;
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: current.id,
        status: BookingStatus.COMPLETED,
        actorType: BookingActorType.USER,
        actorUserId: input.actorUserId,
        reason: "Voucher uplatněn při dokončení návštěvy",
        metadata: {
          source: "admin-booking-complete-flow-v1",
          amount: redemption.redemption.amountCzk,
          voucherCode: redemption.voucher.code,
        },
      },
    });
  }

  const paidAfterCompletion = await tx.booking.findUniqueOrThrow({
    where: { id: current.id },
    select: {
      voucherRedemptions: { select: { amountCzk: true } },
      payments: { select: { amountCzk: true, status: true } },
    },
  });
  const afterSummary = getBookingPaymentSummary({
    totalPriceCzk: current.finalPriceCzk ?? current.servicePriceFromCzk ?? current.service.priceFromCzk ?? 0,
    voucherRedemptions: paidAfterCompletion.voucherRedemptions,
    payments: paidAfterCompletion.payments,
  });
  if (input.mode !== "no_payment" && afterSummary.remainingCzk > 0) {
    throw new CompletionPaymentError("Zadaná úhrada nepokrývá celý doplatek.");
  }

  const completionReason = input.mode === "no_payment" && currentSummary.remainingCzk > 0
    ? `Rezervace označena jako hotová s neuhrazeným doplatkem. ${input.baseReason ?? ""}`.trim()
    : input.baseReason;
  if (!completionApplied) {
    const completion = await applyAdminBookingStatusChangeInTransaction(tx, {
      bookingId: current.id,
      targetStatus: BookingStatus.COMPLETED,
      actorUserId: input.actorUserId,
      notifyClient: false,
      reason: completionReason,
    });
    if (completion.status !== "success") throw new CompletionPaymentError("Stav rezervace se nepodařilo změnit.");
  }

  return { voucherId };
}
