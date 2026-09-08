"use server";



import { z } from "zod";

import { type AdminArea } from "@/config/navigation";





import { type UpdateBookingNoteActionState } from "@/features/admin/actions/update-booking-note-action-state";



import {



  updateAdminBookingInternalNote,
} from "@/features/admin/lib/admin-booking";
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








import {


  readFormString,
  revalidateBookingAdminPaths,


  resolveBookingActorUserId,


} from "./shared";

const updateBookingNoteSchema = z.object({
  area: z.enum(["owner", "salon"]),
  bookingId: z.string().trim().min(1).max(64),
  expectedUpdatedAt: z.string().trim().min(1).max(64),
  internalNote: z.string().trim().max(1000, "Interní poznámka je příliš dlouhá."),
});


export async function updateBookingNoteAction(
  _previousState: UpdateBookingNoteActionState,
  formData: FormData,
): Promise<UpdateBookingNoteActionState> {
  const parsed = updateBookingNoteSchema.safeParse({
    area: readFormString(formData, "area"),
    bookingId: readFormString(formData, "bookingId"),
    expectedUpdatedAt: readFormString(formData, "expectedUpdatedAt"),
    internalNote: readFormString(formData, "internalNote"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;

    return {
      status: "error",
      formError: "Poznámku se nepodařilo uložit.",
      fieldErrors: {
        internalNote: fieldErrors.internalNote?.[0],
      },
    };
  }

  const area = parsed.data.area as AdminArea;
  const actorUserId = await resolveBookingActorUserId(area);
  const result = await updateAdminBookingInternalNote({
    bookingId: parsed.data.bookingId,
    actorUserId,
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    internalNote: parsed.data.internalNote || null,
  });

  if (result.status === "not-found") {
    return {
      status: "error",
      formError: "Rezervaci se nepodařilo najít.",
    };
  }

  if (result.status === "concurrent-modification") {
    return {
      status: "error",
      conflict: true,
      formError: "Rezervace se mezitím změnila v jiném okně. Načtěte aktuální poznámku a zkuste to znovu.",
    };
  }

  revalidateBookingAdminPaths(parsed.data.bookingId);

  return {
    status: "success",
    successMessage: parsed.data.internalNote
      ? "Interní poznámka je uložená."
      : "Interní poznámka byla odstraněná.",
  };
}
