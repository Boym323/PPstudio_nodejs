"use client";

import { BookingSource, BookingStatus } from "@/generated/prisma/browser";
import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";

import * as Dialog from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { type AdminArea } from "@/config/navigation";
import {
  initialCreateManualBookingActionState,
} from "@/features/admin/actions/create-manual-booking-action-state";
import { createManualBookingAction } from "@/features/admin/actions/bookings/create-manual-booking";
import { type ReservationsDashboardData } from "@/features/admin/lib/data/reservations";
import { BookingClientSelector } from "./booking-client-selector";
import { BookingInternalNoteField } from "./booking-internal-note-field";
import { BookingNotificationOptions } from "./booking-notification-options";
import { BookingServiceSelector } from "./booking-service-selector";
import { BookingSourceField } from "./booking-source-field";
import { BookingTimeSelector } from "./booking-time-selector";

type CreateManualBookingDrawerProps = {
  area: AdminArea;
  data: ReservationsDashboardData["manualBooking"];
  initialOpen?: boolean;
  prefilledClient?: ReservationsDashboardData["manualBooking"]["clients"][number] | null;
  prefillWarning?: string | null;
};

type ClientOption = ReservationsDashboardData["manualBooking"]["clients"][number];

export function CreateManualBookingDrawer({
  area,
  data,
  initialOpen = false,
  prefilledClient = null,
  prefillWarning = null,
}: CreateManualBookingDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(initialOpen);
  const { toast } = useToast();
  const [serverState, formAction] = useActionState(
    createManualBookingAction,
    initialCreateManualBookingActionState,
  );
  const previousStatus = useRef(serverState.status);
  const [clientQuery, setClientQuery] = useState("");
  const [clientOptions, setClientOptions] = useState<ClientOption[]>(data.clients);
  const [selectedClientId, setSelectedClientId] = useState(prefilledClient?.id ?? "");
  const [fullName, setFullName] = useState(prefilledClient?.fullName ?? "");
  const [email, setEmail] = useState(prefilledClient?.email ?? "");
  const [phone, setPhone] = useState(prefilledClient?.phone ?? "");
  const [clientProfileNote, setClientProfileNote] = useState(prefilledClient?.internalNote ?? "");
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceId, setServiceId] = useState("");
  const initialPrefilledDate = searchParams.get("date")?.trim() ?? "";
  const initialPrefilledTime = searchParams.get("time")?.trim() ?? "";
  const hasInitialPrefilledTime = initialPrefilledDate.length > 0 && initialPrefilledTime.length > 0;
  const [selectionMode, setSelectionMode] = useState<"slot" | "manual">(
    hasInitialPrefilledTime ? "manual" : "slot",
  );
  const [slotId, setSlotId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [manualDate, setManualDate] = useState(initialPrefilledDate);
  const [manualTime, setManualTime] = useState(initialPrefilledTime);
  const [source, setSource] = useState<BookingSource>(BookingSource.PHONE);
  const [bookingStatus, setBookingStatus] = useState<"PENDING" | "CONFIRMED">(
    BookingStatus.CONFIRMED,
  );
  const [includeCalendarAttachment, setIncludeCalendarAttachment] = useState(true);
  const [clientNote, setClientNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [prefillNotice, setPrefillNotice] = useState(prefillWarning);
  const appliedPrefilledClientId = useRef(prefilledClient?.id ?? null);
  const appliedPrefillWarning = useRef(prefillWarning);
  const visibleClientOptions = clientQuery.trim().length >= 2 ? clientOptions : [];
  const availableClients = prefilledClient && !visibleClientOptions.some((client) => client.id === prefilledClient.id)
    ? [prefilledClient, ...visibleClientOptions]
    : visibleClientOptions;

  useEffect(() => {
    if (!prefilledClient || appliedPrefilledClientId.current === prefilledClient.id) {
      return;
    }

    appliedPrefilledClientId.current = prefilledClient.id;
    setSelectedClientId(prefilledClient.id);
    setFullName(prefilledClient.fullName);
    setEmail(prefilledClient.email);
    setPhone(prefilledClient.phone ?? "");
    setClientProfileNote(prefilledClient.internalNote ?? "");
  }, [prefilledClient]);

  useEffect(() => {
    if (appliedPrefillWarning.current === prefillWarning) {
      return;
    }

    appliedPrefillWarning.current = prefillWarning;
    setPrefillNotice(prefillWarning);
  }, [prefillWarning]);

  useEffect(() => {
    const query = clientQuery.trim();
    if (query.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/clients/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });
        const result = await response.json() as { clients?: ClientOption[] };
        if (response.ok) setClientOptions(result.clients ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setClientOptions([]);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [clientQuery]);

  const createdBookingHref = serverState.createdBookingId
    ? area === "owner"
      ? `/admin/rezervace/${serverState.createdBookingId}`
      : `/admin/provoz/rezervace/${serverState.createdBookingId}`
    : null;

  const clearCreateBookingSearchParams = useCallback(() => {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("create");
    nextSearchParams.delete("clientId");
    nextSearchParams.delete("date");
    nextSearchParams.delete("time");
    const nextHref = nextSearchParams.toString() ? `${pathname}?${nextSearchParams.toString()}` : pathname;

    router.replace(nextHref);
  }, [pathname, router, searchParams]);

  function resetForm() {
    setClientQuery("");
    setSelectedClientId("");
    setFullName("");
    setEmail("");
    setPhone("");
    setClientProfileNote("");
    setServiceSearch("");
    setServiceId("");
    setSelectionMode(hasInitialPrefilledTime ? "manual" : "slot");
    setSlotId("");
    setStartsAt("");
    setManualDate(initialPrefilledDate);
    setManualTime(initialPrefilledTime);
    setSource(BookingSource.PHONE);
    setBookingStatus(BookingStatus.CONFIRMED);
    setIncludeCalendarAttachment(true);
    setClientNote("");
    setInternalNote("");
    setPrefillNotice(null);
  }

  useEffect(() => {
    if (previousStatus.current !== "success" && serverState.status === "success") {
      setClientQuery("");
      setSelectedClientId("");
      setFullName("");
      setEmail("");
      setPhone("");
      setClientProfileNote("");
      setServiceSearch("");
      setServiceId("");
      setSelectionMode(hasInitialPrefilledTime ? "manual" : "slot");
      setSlotId("");
      setStartsAt("");
      setManualDate(initialPrefilledDate);
      setManualTime(initialPrefilledTime);
      setSource(BookingSource.PHONE);
      setBookingStatus(BookingStatus.CONFIRMED);
      setIncludeCalendarAttachment(true);
      setClientNote("");
      setInternalNote("");
      setPrefillNotice(null);
      setOpen(false);
      clearCreateBookingSearchParams();
      toast({ message: serverState.successMessage ?? "Rezervace byla vytvořena." });
      router.refresh();
    }

    previousStatus.current = serverState.status;
  }, [
    clearCreateBookingSearchParams,
    hasInitialPrefilledTime,
    initialPrefilledDate,
    initialPrefilledTime,
    router,
    serverState.formError,
    serverState.successMessage,
    serverState.status,
    toast,
  ]);

  function closeDrawer() {
    resetForm();
    setOpen(false);
    clearCreateBookingSearchParams();
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
        } else {
          closeDrawer();
        }
      }}
    >
      <div className="flex items-center justify-end">
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="rounded-full border border-[var(--color-accent)]/34 bg-[rgba(190,160,120,0.12)] px-4 py-2.5 text-sm font-semibold text-white transition hover:border-[var(--color-accent)]/46 hover:bg-[rgba(190,160,120,0.18)]"
          >
            Přidat rezervaci
          </button>
        </Dialog.Trigger>
      </div>

      {!open && serverState.status === "success" && (serverState.manualOverrideWarning || createdBookingHref) ? (
        <div className="mt-3 max-w-full overflow-hidden rounded-[1rem] border border-emerald-300/18 bg-emerald-500/10 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              {serverState.manualOverrideWarning ? (
                <p className="mt-1 break-words text-sm leading-6 text-emerald-100/80">{serverState.manualOverrideWarning}</p>
              ) : null}
              {createdBookingHref ? (
                <Link
                  href={createdBookingHref}
                  className="mt-2 inline-flex text-sm font-medium text-white underline underline-offset-4"
                >
                  Otevřít detail rezervace
                </Link>
              ) : null}
            </div>

          </div>
        </div>
      ) : null}

      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="!inset-y-0 !right-0 !left-auto z-[90] !h-[100dvh] !max-h-none !w-full !max-w-4xl !translate-x-0 !translate-y-0 !overflow-hidden border-l border-white/10 bg-[#131116] shadow-[-20px_0_70px_rgba(0,0,0,0.45)]">
            <div className="flex h-full flex-col">
              <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#131116]/96 px-5 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top))] backdrop-blur sm:px-6 sm:py-5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-soft)]">
                    Ruční rezervace
                  </p>
                  <Dialog.Title>Nová rezervace</Dialog.Title>
                  <Dialog.Description>
                    Vyberte klientku, službu a termín. Detaily a oznámení můžete upravit před uložením.
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
                <input type="hidden" name="selectionMode" value={selectionMode} />
                <input type="hidden" name="selectedClientId" value={selectedClientId} />
                <input type="hidden" name="serviceId" value={serviceId} />
                <input type="hidden" name="slotId" value={slotId} />
                <input type="hidden" name="startsAt" value={startsAt} />
                <input type="hidden" name="fullName" value={fullName} />
                <input type="hidden" name="email" value={email} />
                <input type="hidden" name="phone" value={phone} />
                <input type="hidden" name="clientProfileNote" value={clientProfileNote} />
                <input type="hidden" name="source" value={source} />
                <input type="hidden" name="bookingStatus" value={bookingStatus} />
                <input type="hidden" name="includeCalendarAttachment" value={includeCalendarAttachment ? "1" : "0"} />
                <input type="hidden" name="clientNote" value={clientNote} />
                <input type="hidden" name="internalNote" value={internalNote} />

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                  <div className="space-y-8 pb-8">
                    {serverState.status === "error" && serverState.formError ? (
                      <div className="rounded-[1rem] border border-red-300/16 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-50">
                        {serverState.formError}
                      </div>
                    ) : null}

                    {prefillNotice ? (
                      <div
                        className={
                          prefilledClient && !prefilledClient.isActive
                            ? "rounded-[1rem] border border-amber-300/18 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-50"
                            : "rounded-[1rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/74"
                        }
                      >
                        {prefillNotice}
                      </div>
                    ) : null}

                    {hasInitialPrefilledTime ? (
                      <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/74">
                        Předvyplněný termín: {initialPrefilledDate} v {initialPrefilledTime}. Můžete ho ponechat nebo upravit.
                      </div>
                    ) : null}

                    <div>
                      <BookingClientSelector
                        clients={availableClients}
                        query={clientQuery}
                        onQueryChange={setClientQuery}
                        selectedClientId={selectedClientId}
                        onSelectClient={(clientId) => {
                          setPrefillNotice(null);
                          setSelectedClientId(clientId);
                          const selectedClient = availableClients.find((client) => client.id === clientId);

                          if (!selectedClient) {
                            return;
                          }

                          setFullName(selectedClient.fullName);
                          setEmail(selectedClient.email);
                          setPhone(selectedClient.phone ?? "");
                          setClientProfileNote(selectedClient.internalNote ?? "");
                        }}
                        onClearSelection={() => {
                          setPrefillNotice(null);
                          setSelectedClientId("");
                          setFullName("");
                          setEmail("");
                          setPhone("");
                          setClientProfileNote("");
                        }}
                        fullName={fullName}
                        onFullNameChange={setFullName}
                        email={email}
                        onEmailChange={setEmail}
                        phone={phone}
                        onPhoneChange={setPhone}
                        clientProfileNote={clientProfileNote}
                        onClientProfileNoteChange={setClientProfileNote}
                        fieldErrors={serverState.fieldErrors}
                      />
                    </div>

                    <div className="border-t border-white/8 pt-7">
                      <BookingServiceSelector
                        services={data.services}
                        serviceId={serviceId}
                        onServiceIdChange={(value) => {
                          setServiceId(value);
                          setSlotId("");
                          setStartsAt("");
                        }}
                        search={serviceSearch}
                        onSearchChange={setServiceSearch}
                        error={serverState.fieldErrors?.serviceId}
                      />
                    </div>

                    <div className="border-t border-white/8 pt-7">
                      <BookingTimeSelector
                        slots={data.slots}
                        scheduleOptimization={data.scheduleOptimization}
                        services={data.services}
                        serviceId={serviceId}
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
                    </div>

                    {selectionMode === "manual" ? (
                      <>
                        <input type="hidden" name="manualDate" value={manualDate} />
                        <input type="hidden" name="manualTime" value={manualTime} />
                      </>
                    ) : (
                      <>
                        <input type="hidden" name="manualDate" value="" />
                        <input type="hidden" name="manualTime" value="" />
                      </>
                    )}

                    <div className="space-y-4 border-t border-white/8 pt-7">
                      <div>
                        <h2 className="text-xl font-display text-white">Detaily</h2>
                        <p className="mt-1 text-sm leading-6 text-white/58">
                          Nastavte stav, zdroj, oznámení a interní poznámky.
                        </p>
                      </div>
                      <BookingSourceField
                        source={source}
                        onSourceChange={setSource}
                        bookingStatus={bookingStatus}
                        onBookingStatusChange={setBookingStatus}
                        sourceError={serverState.fieldErrors?.source}
                        statusError={serverState.fieldErrors?.bookingStatus}
                      />

                      <BookingNotificationOptions
                        includeCalendarAttachment={includeCalendarAttachment}
                        onIncludeCalendarAttachmentChange={setIncludeCalendarAttachment}
                      />

                      <BookingInternalNoteField
                        clientNote={clientNote}
                        onClientNoteChange={setClientNote}
                        internalNote={internalNote}
                        onInternalNoteChange={setInternalNote}
                      />
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 border-t border-white/10 bg-[#131116]/96 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-6 sm:py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm leading-6 text-white/58">
                      Stejné chování pro OWNER i SALON. Rozdíl je jen v cestě do administrace, ne v logice rezervace.
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="rounded-full border border-white/10 px-4 py-2.5 text-sm text-white/80 transition hover:border-white/18 hover:bg-white/6"
                        >
                          Zrušit
                        </button>
                      </Dialog.Close>
                      <CreateSubmitButton mode="create" label="Vytvořit rezervaci" />
                      <CreateSubmitButton mode="create-and-send" label="Vytvořit a poslat potvrzení" primary />
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

function CreateSubmitButton({ mode, label, primary = false }: { mode: "create" | "create-and-send"; label: string; primary?: boolean }) {
  const { pending } = useFormStatus();

  return <button type="submit" name="submitMode" value={mode} disabled={pending} className={primary ? "min-w-44 rounded-full bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-accent-contrast)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60" : "min-w-44 rounded-full border border-white/12 bg-white/6 px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/18 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"}>{pending ? "Vytvářím…" : label}</button>;
}
