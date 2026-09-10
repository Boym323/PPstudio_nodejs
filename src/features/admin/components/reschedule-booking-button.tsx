"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

import * as Dialog from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { type AdminArea } from "@/config/navigation";
import { rescheduleBookingAction } from "@/features/admin/actions/bookings/reschedule-booking";
import {
  initialRescheduleBookingActionState,
} from "@/features/admin/actions/reschedule-booking-action-state";
import { BookingRescheduleTimeSelector } from "./booking-reschedule-time-selector";
import type { PublicBookingCatalog } from "@/features/booking/lib/booking-public";

type SlotCatalogItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  publicNote: string | null;
  capacity: number;
  serviceRestrictionMode: "ANY" | "SELECTED";
  allowedServiceIds: string[];
  bookedIntervals: Array<{
    startsAt: string;
    endsAt: string;
  }>;
};

type RescheduleBookingButtonProps = {
  area: AdminArea;
  bookingId: string;
  serviceId: string;
  serviceName: string;
  serviceDurationMinutes: number;
  cleanupBlockMinutes: number;
  currentScheduledAtLabel: string;
  currentStartsAt: string;
  expectedUpdatedAt: string;
  rescheduleCount: number;
  slots: SlotCatalogItem[];
  scheduleOptimization: PublicBookingCatalog["scheduleOptimization"];
  variant?: "panel" | "inline";
};

function getInitialManualDate(isoValue: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoValue));
}

function getInitialManualTime(isoValue: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoValue));
}

export function RescheduleBookingButton({
  area,
  bookingId,
  serviceId,
  serviceName,
  serviceDurationMinutes,
  cleanupBlockMinutes,
  currentScheduledAtLabel,
  currentStartsAt,
  expectedUpdatedAt,
  rescheduleCount,
  slots,
  scheduleOptimization,
  variant = "panel",
}: RescheduleBookingButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState<"slot" | "manual">("slot");
  const [slotId, setSlotId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [manualDate, setManualDate] = useState(getInitialManualDate(currentStartsAt));
  const [manualTime, setManualTime] = useState(getInitialManualTime(currentStartsAt));
  const [reason, setReason] = useState("");
  const [notifyClient, setNotifyClient] = useState(true);
  const [includeCalendarAttachment, setIncludeCalendarAttachment] = useState(true);
  const { toast } = useToast();
  const [serverState, formAction] = useActionState(
    rescheduleBookingAction,
    initialRescheduleBookingActionState,
  );
  const previousStatus = useRef(serverState.status);

  useEffect(() => {
    if (previousStatus.current !== "success" && serverState.status === "success") {
      setOpen(false);
      toast({ message: serverState.successMessage ?? "Termín byl přesunut." });
      router.refresh();
    }

    previousStatus.current = serverState.status;
  }, [router, serverState.formError, serverState.status, serverState.successMessage, toast]);

  function resetForm() {
    setSelectionMode("slot");
    setSlotId("");
    setStartsAt("");
    setManualDate(getInitialManualDate(currentStartsAt));
    setManualTime(getInitialManualTime(currentStartsAt));
    setReason("");
    setNotifyClient(true);
    setIncludeCalendarAttachment(true);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className={variant === "inline" ? undefined : "min-w-0"}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            onClick={() => {
              resetForm();
            }}
            className={
              variant === "inline"
                ? "rounded-full border border-white/10 px-3 py-1.5 text-sm text-white/76 transition hover:border-white/18 hover:bg-white/6 hover:text-white"
                : "h-full w-full rounded-[1rem] border border-white/12 bg-white/[0.045] px-3.5 py-3 text-left transition hover:border-white/18 hover:bg-white/[0.065]"
            }
          >
            {variant === "inline" ? (
              "Přesunout termín"
            ) : (
              <>
                <span className="block text-sm font-semibold text-white">Přesunout termín</span>
                <span className="mt-1 block text-sm leading-5 text-white/60">
                  Důležitá provozní změna, ale neuzavírá návštěvu.
                </span>
              </>
            )}
          </button>
        </Dialog.Trigger>

        {!open && serverState.status === "success" && serverState.warningMessage ? (
          <div className="mt-3 max-w-full overflow-hidden rounded-[1rem] border border-emerald-300/18 bg-emerald-500/10 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                {serverState.warningMessage ? (
                  <p className="mt-1 break-words text-sm leading-6 text-emerald-100/80">
                    {serverState.warningMessage}
                  </p>
                ) : null}
              </div>

            </div>
          </div>
        ) : null}
      </div>

      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="!inset-y-0 !right-0 !left-auto z-[90] !h-[100dvh] !max-h-none !w-full !max-w-3xl !translate-x-0 !translate-y-0 !overflow-hidden border-l border-white/10 bg-[#131116] shadow-[-20px_0_70px_rgba(0,0,0,0.45)]">
                <div className="flex h-full flex-col">
                  <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#131116]/96 px-5 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top))] backdrop-blur sm:px-6 sm:py-5">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-soft)]">
                        Přesun rezervace
                      </p>
                      <Dialog.Title>Změnit termín rezervace</Dialog.Title>
                      <Dialog.Description>
                        Rezervace zůstane stejný booking, ale změna projde validací, auditním logem a návazným workflow.
                      </Dialog.Description>
                    </div>

                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="min-h-11 min-w-11 rounded-full border border-white/10 px-3 py-2 text-sm text-white/74 transition hover:border-white/18 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                      >
                        Zavřít
                      </button>
                    </Dialog.Close>
                  </header>

                  <form action={formAction} className="flex min-h-0 flex-1 flex-col">
                    <input type="hidden" name="area" value={area} />
                    <input type="hidden" name="bookingId" value={bookingId} />
                    <input type="hidden" name="selectionMode" value={selectionMode} />
                    <input type="hidden" name="slotId" value={slotId} />
                    <input type="hidden" name="startsAt" value={startsAt} />
                    <input type="hidden" name="manualDate" value={selectionMode === "manual" ? manualDate : ""} />
                    <input type="hidden" name="manualTime" value={selectionMode === "manual" ? manualTime : ""} />
                    <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
                    <input type="hidden" name="reason" value={reason} />
                    <input type="hidden" name="notifyClient" value={notifyClient ? "1" : "0"} />
                    <input type="hidden" name="includeCalendarAttachment" value={includeCalendarAttachment ? "1" : "0"} />

                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                      <div className="space-y-4 pb-8">
                        {serverState.status === "error" && serverState.formError ? (
                          <div className="rounded-[1rem] border border-red-300/16 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-50">
                            {serverState.formError}
                          </div>
                        ) : null}

                        <section className="grid gap-3 md:grid-cols-2">
                          <InfoCard label="Současný termín" value={currentScheduledAtLabel} />
                          <InfoCard label="Služba" value={`${serviceName} • ${serviceDurationMinutes} min`} detail={rescheduleCount > 0 ? `Přesunuto už ${rescheduleCount}×` : "První změna termínu"} />
                        </section>

                        <BookingRescheduleTimeSelector
                          slots={slots}
                          scheduleOptimization={scheduleOptimization}
                          serviceId={serviceId}
                          serviceDurationMinutes={serviceDurationMinutes}
                          cleanupBlockMinutes={cleanupBlockMinutes}
                          selectionMode={selectionMode}
                          onSelectionModeChange={setSelectionMode}
                          slotId={slotId}
                          onSlotIdChange={setSlotId}
                          startsAt={startsAt}
                          onStartsAtChange={setStartsAt}
                          manualDate={manualDate}
                          onManualDateChange={setManualDate}
                          manualTime={manualTime}
                          onManualTimeChange={setManualTime}
                          errorSlot={serverState.fieldErrors?.slotId}
                          errorManualDate={serverState.fieldErrors?.manualDate}
                          errorManualTime={serverState.fieldErrors?.manualTime}
                        />

                        <section className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent-soft)]">
                            4. Důvod změny
                          </p>
                          <h3 className="mt-2 text-lg font-semibold text-white">Volitelná poznámka do historie</h3>
                          <textarea
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            maxLength={300}
                            rows={4}
                            placeholder="Např. klientka volala a potřebovala posunout termín, nebo salon přesouvá rezervaci z provozních důvodů."
                            className="mt-4 w-full rounded-[1rem] border border-white/8 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[var(--color-accent)]/55 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/45"
                          />
                          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/42">
                            <span>Uloží se do auditní historie přesunu.</span>
                            <span>{reason.length}/300</span>
                          </div>
                          {serverState.fieldErrors?.reason ? <p className="mt-2 text-sm text-red-300">{serverState.fieldErrors.reason}</p> : null}
                        </section>

                        <section className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent-soft)]">
                            5. Oznámení klientce
                          </p>
                          <h3 className="mt-2 text-lg font-semibold text-white">Co se má stát po přesunu</h3>
                          <div className="mt-4 grid gap-2">
                            <CheckboxRow
                              checked={notifyClient}
                              label="Poslat e-mail o změně termínu"
                              description="Založí se samostatný email typu „Termín byl změněn“ do stejné email pipeline jako ostatní booking zprávy."
                              onChange={setNotifyClient}
                            />
                            <CheckboxRow
                              checked={includeCalendarAttachment}
                              label="Přiložit novou .ics událost"
                              description="Hodí se hlavně u potvrzených rezervací, aby si klientka mohla termín přepsat v kalendáři jedním klikem."
                              onChange={setIncludeCalendarAttachment}
                              disabled={!notifyClient}
                            />
                          </div>
                        </section>
                      </div>
                    </div>

                    <div className="sticky bottom-0 border-t border-white/10 bg-[#131116]/96 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-6 sm:py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm leading-6 text-white/58">
                          OWNER i SALON používají stejnou doménovou akci i stejné validace. Rozdíl je jen v admin cestě.
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Dialog.Close asChild>
                            <button
                              type="button"
                              className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-white/76 transition hover:border-white/18 hover:bg-white/6"
                            >
                              Zrušit
                            </button>
                          </Dialog.Close>
                          <SubmitButton />
                        </div>
                      </div>
                    </div>
                  </form>
                </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InfoCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-[1.05rem] border border-white/7 bg-white/[0.035] p-3.5">
      <p className="text-[0.68rem] uppercase tracking-[0.2em] text-white/46">{label}</p>
      <p className="mt-1.5 text-sm leading-6 text-white">{value}</p>
      {detail ? <p className="mt-1 text-sm leading-5 text-white/54">{detail}</p> : null}
    </div>
  );
}

function CheckboxRow({
  checked,
  label,
  description,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}>
      <span className="flex items-start gap-3 rounded-[1rem] border border-white/8 bg-black/12 px-3.5 py-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-white/20 bg-black/20 text-[var(--color-accent)]"
        />
        <span>
          <span className="block text-sm font-medium text-white">{label}</span>
          <span className="mt-1 block text-sm leading-5 text-white/62">{description}</span>
        </span>
      </span>
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="min-w-40 rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-accent-contrast)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Přesouvám…" : "Potvrdit přesun"}
    </button>
  );
}
