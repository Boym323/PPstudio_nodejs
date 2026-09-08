"use server";

import { AdminRole, BookingStatus, VoucherType } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";



import { type CompleteBookingVisitActionState } from "@/features/admin/actions/complete-booking-visit-action-state";







import { CompletionPaymentError, completeBookingVisitInTransaction } from "@/features/admin/lib/booking/complete-booking-visit";
import { getBookingStatusLabel } from "@/features/booking/lib/booking-status-presentation";
import {
  canApplyAdminBookingTransition,
  canCompleteBookingAt,

} from "@/features/booking/domain/booking-status-transition";
import {





} from "@/features/booking/lib/booking-public";
import {



} from "@/features/booking/lib/booking-rescheduling";

import {
  VoucherRedemptionError,
  voucherRedemptionErrorCodes,
} from "@/features/vouchers/lib/voucher-redemption";
import { normalizeVoucherCode } from "@/features/vouchers/lib/voucher-code";
import { getBookingPaymentSummary } from "@/features/booking/payments/lib/booking-payment-summary";
import { requireRole } from "@/lib/auth/session";
import { sendOwnerSystemErrorPushover } from "@/lib/notifications/pushover";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/serializable-transaction";


import {
  getVoucherRedemptionFormError,

  readFormString,
  revalidateBookingAdminPaths,




  resolveVoucherRedemptionActorUserId,
} from "./shared";

const completeBookingVisitSchema = z
  .object({
    area: z.enum(["owner", "salon"]),
    bookingId: z.string().trim().min(1).max(64),
    completionMode: z.enum(["cash", "qr", "voucher", "combined", "no_payment", "settled"]),
    reason: z.string().trim().max(160, "Důvod je příliš dlouhý.").optional().or(z.literal("")),
    voucherCode: z.string().trim().max(64).optional().or(z.literal("")),
    voucherAmountCzk: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce
        .number({ error: "Částka voucheru musí být celé číslo v Kč." })
        .int("Částka voucheru musí být celé číslo v Kč.")
        .min(1, "Částka voucheru musí být vyšší než 0.")
        .optional(),
    ),
    directAmountCzk: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce
        .number({ error: "Částka platby musí být celé číslo v Kč." })
        .int("Částka platby musí být celé číslo v Kč.")
        .min(1, "Částka platby musí být vyšší než 0.")
        .optional(),
    ),
    directMethod: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.enum(["CASH", "BANK_TRANSFER"]).optional(),
    ),
    paymentNote: z.string().trim().max(500, "Poznámka je příliš dlouhá.").optional().or(z.literal("")),
    idempotencyKey: z.string().uuid("Neplatný identifikátor požadavku."),
  })
  .superRefine((value, ctx) => {
    if (value.completionMode === "no_payment" && !(value.reason ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Pro dokončení bez úhrady je povinný důvod.",
      });
    }

    if (
      (value.completionMode === "voucher" || value.completionMode === "combined")
      && !(value.voucherCode ?? "").trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["voucherCode"],
        message: "Zadejte kód voucheru.",
      });
    }

    if (value.completionMode === "combined" && !value.directMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["directMethod"],
        message: "Vyberte způsob přímé platby.",
      });
    }

    if (
      (value.completionMode === "cash" || value.completionMode === "qr" || value.completionMode === "combined")
      && !value.directAmountCzk
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["directAmountCzk"],
        message: "Zadejte částku přímé platby.",
      });
    }
  });

export async function completeBookingVisitAction(
  _previousState: CompleteBookingVisitActionState,
  formData: FormData,
): Promise<CompleteBookingVisitActionState> {
  const parsed = completeBookingVisitSchema.safeParse({
    area: readFormString(formData, "area"),
    bookingId: readFormString(formData, "bookingId"),
    completionMode: readFormString(formData, "completionMode"),
    reason: readFormString(formData, "reason"),
    voucherCode: readFormString(formData, "voucherCode"),
    voucherAmountCzk: readFormString(formData, "voucherAmountCzk"),
    directAmountCzk: readFormString(formData, "directAmountCzk"),
    directMethod: readFormString(formData, "directMethod"),
    paymentNote: readFormString(formData, "paymentNote"),
    idempotencyKey: readFormString(formData, "idempotencyKey"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      status: "error",
      formError: "Dokončení návštěvy je potřeba doplnit nebo opravit.",
      fieldErrors: {
        completionMode: fieldErrors.completionMode?.[0],
        reason: fieldErrors.reason?.[0],
        voucherCode: fieldErrors.voucherCode?.[0],
        voucherAmountCzk: fieldErrors.voucherAmountCzk?.[0],
        directAmountCzk: fieldErrors.directAmountCzk?.[0],
        directMethod: fieldErrors.directMethod?.[0],
      },
    };
  }

  const session = await requireRole([AdminRole.OWNER, AdminRole.SALON]);
  const actorUserId = await resolveVoucherRedemptionActorUserId(session.email);
  const booking = await prisma.booking.findUnique({
    where: { id: parsed.data.bookingId },
    select: {
      id: true,
      serviceId: true,
      status: true,
      scheduledEndsAt: true,
      finalPriceCzk: true,
      servicePriceFromCzk: true,
      voucherRedemptions: { select: { amountCzk: true } },
      payments: { select: { amountCzk: true, status: true } },
      service: { select: { priceFromCzk: true } },
    },
  });

  if (!booking) {
    return { status: "error", formError: "Rezervaci se nepodařilo najít." };
  }

  if (!canApplyAdminBookingTransition(booking.status, BookingStatus.COMPLETED)) {
    return {
      status: "error",
      formError: `Rezervaci ve stavu „${getBookingStatusLabel(booking.status)}“ teď nejde dokončit.`,
    };
  }

  if (!canCompleteBookingAt(booking.scheduledEndsAt)) {
    return {
      status: "error",
      formError: "Rezervaci lze dokončit až po skončení naplánovaného termínu.",
    };
  }

  const paymentSummary = getBookingPaymentSummary({
    totalPriceCzk: booking.finalPriceCzk ?? booking.servicePriceFromCzk ?? booking.service.priceFromCzk ?? 0,
    voucherRedemptions: booking.voucherRedemptions,
    payments: booking.payments,
  });
  const remainingCzk = paymentSummary.remainingCzk;
  const mode = parsed.data.completionMode;
  const note = parsed.data.paymentNote?.trim() || null;
  const baseReason = parsed.data.reason?.trim() || undefined;

  if (remainingCzk > 0 && mode === "settled") {
    return {
      status: "error",
      formError: "Při doplatku je potřeba vybrat způsob úhrady nebo dokončení bez úhrady.",
      fieldErrors: { completionMode: "Vyberte způsob dokončení návštěvy." },
    };
  }

  const directAmountCzk =
    mode === "cash" || mode === "qr" || mode === "combined"
      ? parsed.data.directAmountCzk ?? remainingCzk
      : 0;
  let plannedVoucherAmountCzk = 0;
  let redeemedVoucherId: string | null = null;

  if ((mode === "voucher" || mode === "combined") && remainingCzk > 0) {
    const normalizedVoucherCode = normalizeVoucherCode(parsed.data.voucherCode ?? "");
    const voucher = await prisma.voucher.findUnique({
      where: { code: normalizedVoucherCode },
      select: {
        id: true,
        type: true,
        remainingValueCzk: true,
        serviceId: true,
        servicePriceSnapshotCzk: true,
      },
    });

    if (!voucher) {
      return {
        status: "error",
        formError: getVoucherRedemptionFormError(
          new VoucherRedemptionError(voucherRedemptionErrorCodes.voucherNotFound, "Voucher was not found."),
        ),
        fieldErrors: { voucherCode: "Voucher se nepodařilo najít." },
      };
    }

    if (voucher.type === VoucherType.VALUE) {
      const requestedVoucherAmountCzk =
        parsed.data.voucherAmountCzk ?? (mode === "voucher" ? remainingCzk : undefined);

      if (!requestedVoucherAmountCzk) {
        return {
          status: "error",
          formError: "U kombinované úhrady hodnotovým voucherem zadejte částku voucheru.",
          fieldErrors: { voucherAmountCzk: "Zadejte částku voucheru." },
        };
      }

      plannedVoucherAmountCzk = Math.min(requestedVoucherAmountCzk, voucher.remainingValueCzk ?? 0);
    } else {
      if (voucher.serviceId !== booking.serviceId) {
        return {
          status: "error",
          formError: getVoucherRedemptionFormError(
            new VoucherRedemptionError(voucherRedemptionErrorCodes.serviceMismatch, "Voucher service does not match booking."),
          ),
          fieldErrors: { voucherCode: "Voucher neodpovídá službě v rezervaci." },
        };
      }

      plannedVoucherAmountCzk =
        voucher.servicePriceSnapshotCzk ?? booking.servicePriceFromCzk ?? booking.service.priceFromCzk ?? 0;
    }
  }

  if (remainingCzk > 0 && mode !== "no_payment") {
    const plannedPaidCzk = directAmountCzk + plannedVoucherAmountCzk;

    if (plannedPaidCzk < remainingCzk) {
      return {
        status: "error",
        formError:
          "Zadaná úhrada nepokrývá celý doplatek. Doplňte platbu, nebo použijte „Bez platby“ s povinným důvodem.",
        fieldErrors:
          mode === "voucher" || mode === "combined"
            ? { voucherAmountCzk: "Úhrada musí pokrýt celý doplatek." }
            : { directAmountCzk: "Úhrada musí pokrýt celý doplatek." },
      };
    }
  }

  try {
    const transactionResult = await runSerializableTransaction((tx) => completeBookingVisitInTransaction(tx, {
      bookingId: booking.id,
      area: parsed.data.area,
      sessionEmail: session.email,
      sessionRole: session.role,
      actorUserId,
      mode,
      baseReason,
      note,
      voucherCode: parsed.data.voucherCode,
      voucherAmountCzk: parsed.data.voucherAmountCzk,
      directAmountCzk: parsed.data.directAmountCzk,
      directMethod: parsed.data.directMethod,
      idempotencyKey: parsed.data.idempotencyKey,
    }));
    redeemedVoucherId = transactionResult.voucherId;
  } catch (error) {
    if (error instanceof VoucherRedemptionError) {
      return {
        status: "error",
        formError: getVoucherRedemptionFormError(error),
        fieldErrors:
          error.code === voucherRedemptionErrorCodes.voucherNotFound
            ? { voucherCode: getVoucherRedemptionFormError(error) }
            : error.code === voucherRedemptionErrorCodes.amountRequired
              || error.code === voucherRedemptionErrorCodes.insufficientRemainingValue
              ? { voucherAmountCzk: getVoucherRedemptionFormError(error) }
              : undefined,
      };
    }

    if (error instanceof CompletionPaymentError) {
      return { status: "error", formError: error.message };
    }

    console.error("Failed to register completion payment flow", error);

    await sendOwnerSystemErrorPushover({
      title: "PP Studio - systemova chyba",
      message: "Dokonceni navstevy nebo zapis uhrady selhal neocekavanou chybou.",
      context: {
        contextId: booking.id,
        bookingId: booking.id,
      },
      error,
    });

    return {
      status: "error",
      formError: "Úhradu se nepodařilo zapsat. Zkuste to prosím znovu.",
    };
  }

	  revalidateBookingAdminPaths(booking.id);
	  if (redeemedVoucherId) {
	    revalidatePath("/admin/vouchery");
	    revalidatePath("/admin/provoz/vouchery");
	    revalidatePath(`/admin/vouchery/${redeemedVoucherId}`);
	    revalidatePath(`/admin/provoz/vouchery/${redeemedVoucherId}`);
	  }

	  return {
    status: "success",
    successMessage:
      mode === "no_payment"
        ? "Návštěva je dokončená bez úhrady a důvod je uložený v historii."
        : "Úhrada je zapsaná a návštěva dokončená.",
  };
}
