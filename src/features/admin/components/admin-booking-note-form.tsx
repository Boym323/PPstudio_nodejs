"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { updateBookingNoteAction } from "@/features/admin/actions/bookings/update-booking-note";
import { initialUpdateBookingNoteActionState } from "@/features/admin/actions/update-booking-note-action-state";
import { type AdminArea } from "@/config/navigation";

export function AdminBookingNoteForm({
  area,
  bookingId,
  expectedUpdatedAt,
  initialValue,
}: {
  area: AdminArea;
  bookingId: string;
  expectedUpdatedAt: string;
  initialValue: string;
}) {
  const [serverState, formAction] = useActionState(
    updateBookingNoteAction,
    initialUpdateBookingNoteActionState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />

      {serverState.status === "success" && serverState.successMessage ? (
        <div className="rounded-[0.9rem] border border-emerald-300/16 bg-emerald-400/10 px-3 py-2 text-sm leading-5 text-emerald-50">
          {serverState.successMessage}
        </div>
      ) : null}

      {serverState.status === "error" && serverState.formError ? (
        <div className="rounded-[0.9rem] border border-red-300/16 bg-red-400/10 px-3 py-2 text-sm leading-5 text-red-50">
          {serverState.formError}
          {serverState.conflict ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 block text-sm font-semibold text-red-100 underline underline-offset-4"
            >
              Načíst aktuální hodnotu
            </button>
          ) : null}
        </div>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-white">Interní poznámka</span>
        <textarea
          name="internalNote"
          rows={3}
          maxLength={1000}
          defaultValue={initialValue}
          placeholder="Např. citlivost na čas, preferovaný kontakt nebo krátký provozní kontext pro tým."
          className="mt-2 w-full rounded-[1rem] border border-white/8 bg-black/20 px-3.5 py-2 text-sm leading-5 text-white outline-none transition placeholder:text-white/30 focus:border-[var(--color-accent)]/55"
        />
        <span className="mt-1.5 block text-xs leading-4 text-white/40">
          Interní poznámka s auditní stopou.
        </span>
        {serverState.fieldErrors?.internalNote ? (
          <p className="mt-2 text-sm text-red-300">{serverState.fieldErrors.internalNote}</p>
        ) : null}
      </label>

      <SubmitButton hasValue={initialValue.trim().length > 0} />
    </form>
  );
}

function SubmitButton({ hasValue }: { hasValue: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-accent-contrast)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending}
    >
      {pending ? "Ukládám poznámku..." : hasValue ? "Upravit poznámku" : "Přidat poznámku"}
    </button>
  );
}
