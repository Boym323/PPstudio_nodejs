"use server";

import { AdminRole } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";








import { type UpdateBookingPriceActionState } from "@/features/admin/actions/update-booking-price-action-state";


import { updateAdminBookingPrice } from "@/features/admin/lib/admin-booking";
import {


} from "@/features/admin/lib/booking/booking-display";
import {



} from "@/features/booking/domain/booking-status-transition";
import {





} from "@/features/booking/lib/booking-public";
import {



} from "@/features/booking/lib/booking-rescheduling";

import {




} from "@/features/vouchers/lib/voucher-redemption";

import { requireRole } from "@/lib/auth/session";

import {


  readFormString,
  revalidateBookingAdminPaths,




  resolveVoucherRedemptionActorUserId,
} from "./shared";

const updateBookingPriceSchema = z.object({
  area: z.enum(["owner", "salon"]),
  bookingId: z.string().trim().min(1).max(64),
  expectedUpdatedAt: z.string().trim().min(1).max(64),
  finalPriceCzk: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce
      .number({ error: "Cenu zadejte jako celé číslo v Kč." })
      .int("Cena musí být celé číslo v Kč.")
      .min(0, "Cena nesmí být záporná.")
      .max(100_000, "Cena je mimo běžný rozsah.")
      .nullable(),
  ),
  priceAdjustmentReason: z.string().trim().max(500, "Důvod je příliš dlouhý.").optional().or(z.literal("")),
  confirmOverpayment: z.enum(["true", ""]).optional(),
});


export async function updateBookingPriceAction(
  _previousState: UpdateBookingPriceActionState,
  formData: FormData,
): Promise<UpdateBookingPriceActionState> {
  const parsed = updateBookingPriceSchema.safeParse({
    area: readFormString(formData, "area"),
    bookingId: readFormString(formData, "bookingId"),
    expectedUpdatedAt: readFormString(formData, "expectedUpdatedAt"),
    finalPriceCzk: readFormString(formData, "finalPriceCzk"),
    priceAdjustmentReason: readFormString(formData, "priceAdjustmentReason"),
    confirmOverpayment: readFormString(formData, "confirmOverpayment"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;

    return {
      status: "error",
      formError: "Cenu rezervace je potřeba doplnit nebo opravit.",
      fieldErrors: {
        finalPriceCzk: fieldErrors.finalPriceCzk?.[0],
        priceAdjustmentReason: fieldErrors.priceAdjustmentReason?.[0],
      },
    };
  }

  const session = await requireRole([AdminRole.OWNER, AdminRole.SALON]);
  const nextFinalPriceCzk = parsed.data.finalPriceCzk;
  const normalizedReason = parsed.data.priceAdjustmentReason?.trim() ?? "";
  const actorUserId = await resolveVoucherRedemptionActorUserId(session.email);
  const result = await updateAdminBookingPrice({
    bookingId: parsed.data.bookingId,
    actorUserId,
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    nextFinalPriceCzk,
    normalizedReason,
    confirmOverpayment: parsed.data.confirmOverpayment === "true",
  });

  if (result.status === "not-found") {
    return { status: "error", formError: "Rezervaci se nepodařilo najít." };
  }
  if (result.status === "concurrent-modification") {
    return {
      status: "error",
      conflict: true,
      formError: "Rezervace se mezitím změnila v jiném okně. Načtěte aktuální cenu a zkuste to znovu.",
    };
  }
  if (result.status === "reason-required") {
    return {
      status: "error",
      formError: "Upravená cena potřebuje krátký důvod.",
      fieldErrors: { priceAdjustmentReason: "Doplňte důvod úpravy ceny." },
    };
  }
  if (result.status === "overpayment-confirmation-required") {
    return {
      status: "error",
      formError: `Po změně vznikne přeplatek ${result.overpaidCzk} Kč. Potvrďte, že chcete cenu uložit.`,
    };
  }

  revalidateBookingAdminPaths(result.bookingId);
  revalidatePath(`/admin/klienti/${result.clientId}`);
  revalidatePath(`/admin/provoz/klienti/${result.clientId}`);

  return {
    status: "success",
    successMessage: result.clearsAdjustment
      ? "Individuální cena byla zrušená, rezervace znovu používá ceníkovou cenu."
      : "Individuální cena rezervace je uložená.",
  };
}
