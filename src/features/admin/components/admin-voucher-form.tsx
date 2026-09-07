"use client";

import Link from "next/link";
import { VoucherType } from "@/generated/prisma/browser";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  createAdminVoucherAction,
} from "@/features/admin/actions/voucher-actions";
import {
  initialCreateVoucherActionState,
} from "@/features/admin/actions/create-voucher-action-state";
import { type AdminVoucherCreatePageData } from "@/features/admin/lib/admin-vouchers";
import { cn } from "@/lib/utils";

type AdminVoucherFormProps = {
  data: AdminVoucherCreatePageData;
};

const czkFormatter = new Intl.NumberFormat("cs-CZ", {
  maximumFractionDigits: 0,
  style: "currency",
  currency: "CZK",
});

export function AdminVoucherForm({ data }: AdminVoucherFormProps) {
  const [serverState, formAction, pending] = useActionState(
    createAdminVoucherAction,
    initialCreateVoucherActionState,
  );
  const [type, setType] = useState<VoucherType>(data.initialValues.type);
  const [serviceId, setServiceId] = useState(data.services[0]?.id ?? "");
  const [originalValueCzk, setOriginalValueCzk] = useState("");
  const originalValueInputRef = useRef<HTMLInputElement>(null);
  const [validFrom, setValidFrom] = useState(data.initialValues.validFrom);
  const [validUntil, setValidUntil] = useState(data.initialValues.validUntil);
  const [purchaserName, setPurchaserName] = useState("");

  useEffect(() => {
    // Na pomalejším mobilním WebKitu může uživatel vyplnit pole před hydratací.
    // Uncontrolled input hodnotu zachová; preview ji po připojení Reactu převezme.
    const hydratedValue = originalValueInputRef.current?.value ?? "";
    if (hydratedValue !== originalValueCzk) {
      setOriginalValueCzk(hydratedValue);
    }
  }, [originalValueCzk]);

  const selectedService = data.services.find((service) => service.id === serviceId) ?? null;
  const preview = useMemo(
    () =>
      buildVoucherPreview({
        type,
        originalValueCzk,
        selectedService,
        validFrom,
        validUntil,
        purchaserName,
      }),
    [originalValueCzk, purchaserName, selectedService, type, validFrom, validUntil],
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="area" value={data.area} />
      <input type="hidden" name="type" value={type} />

      {serverState.status === "error" && serverState.formError ? (
        <div className="rounded-[1.25rem] border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-50">
          {serverState.formError}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="min-w-0 space-y-3">
          <SectionBlock title="Typ a hodnota">
            <div>
              <div className="grid gap-2 sm:grid-cols-2">
                <TypeButton
                  active={type === VoucherType.VALUE}
                  label="Hodnotový poukaz"
                  description="Částka v Kč, kterou lze čerpat postupně."
                  badge="VALUE"
                  onClick={() => setType(VoucherType.VALUE)}
                />
                <TypeButton
                  active={type === VoucherType.SERVICE}
                  label="Poukaz na službu"
                  description="Jednorázové uplatnění na konkrétní aktivní službu."
                  badge="SERVICE"
                  onClick={() => setType(VoucherType.SERVICE)}
                />
              </div>
              {serverState.fieldErrors?.type ? (
                <p className="mt-2 text-sm text-red-300">{serverState.fieldErrors.type}</p>
              ) : null}
            </div>

            {type === VoucherType.VALUE ? (
              <Field label="Hodnota v Kč" error={serverState.fieldErrors?.originalValueCzk}>
                <input
                  ref={originalValueInputRef}
                  type="number"
                  name="originalValueCzk"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  defaultValue={originalValueCzk}
                  onChange={(event) => setOriginalValueCzk(event.target.value)}
                  placeholder="Např. 1500"
                  className={inputClassName}
                />
              </Field>
            ) : (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
                <Field label="Aktivní služba" error={serverState.fieldErrors?.serviceId}>
                  <input type="hidden" name="serviceId" value={serviceId} />
                  {data.services.length === 0 ? (
                    <div className="mt-2 rounded-[1rem] border border-dashed border-white/12 bg-[#0f0d12] px-3.5 py-3 text-sm text-white/58">
                      Žádná aktivní služba
                    </div>
                  ) : (
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto rounded-[1rem] border border-white/10 bg-[#0f0d12] p-2">
                      {data.services.map((service) => {
                        const isSelected = service.id === serviceId;

                        return (
                          <button
                            key={service.id}
                            type="button"
                            onClick={() => setServiceId(service.id)}
                            aria-pressed={isSelected}
                            className={cn(
                              "w-full rounded-[0.95rem] border px-3.5 py-3 text-left transition",
                              isSelected
                                ? "border-[var(--color-accent)]/60 bg-[rgba(190,160,120,0.16)] text-white"
                                : "border-white/8 bg-white/[0.02] text-white/76 hover:border-white/16 hover:bg-white/[0.05]",
                            )}
                          >
                            <p className="text-sm font-medium text-white">
                              {service.publicName ?? service.name}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-white/48">
                              {service.category.name}
                              <span className="mx-1.5 text-white/22">·</span>
                              {service.durationMinutes} min
                              <span className="mx-1.5 text-white/22">·</span>
                              {service.priceFromCzk === null
                                ? "Cena na dotaz"
                                : czkFormatter.format(service.priceFromCzk)}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Field>

                <ServicePreview service={selectedService} />
              </div>
            )}
          </SectionBlock>

          <SectionBlock title="Platnost">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Platnost od" error={serverState.fieldErrors?.validFrom}>
                <input
                  type="date"
                  name="validFrom"
                  required
                  value={validFrom}
                  onChange={(event) => setValidFrom(event.target.value)}
                  className={inputClassName}
                />
              </Field>

              <Field label="Platnost do" error={serverState.fieldErrors?.validUntil}>
                <input
                  type="date"
                  name="validUntil"
                  required
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                  className={inputClassName}
                />
              </Field>
            </div>
          </SectionBlock>

          <SectionBlock title="Kupující">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kupující" error={serverState.fieldErrors?.purchaserName}>
                <input
                  type="text"
                  name="purchaserName"
                  maxLength={160}
                  value={purchaserName}
                  onChange={(event) => setPurchaserName(event.target.value)}
                  placeholder="Jméno kupujícího"
                  className={inputClassName}
                />
              </Field>

              <Field label="E-mail kupujícího" error={serverState.fieldErrors?.purchaserEmail}>
                <input
                  type="email"
                  name="purchaserEmail"
                  maxLength={240}
                  placeholder="email@example.cz"
                  className={inputClassName}
                />
              </Field>
            </div>
          </SectionBlock>

          <SectionBlock title="Interní poznámka">
            <Field label="Poznámka jen pro administraci" error={serverState.fieldErrors?.internalNote}>
              <textarea
                name="internalNote"
                rows={3}
                maxLength={2000}
                placeholder="Např. zaplaceno hotově, domluvené vyzvednutí, doplňující kontext."
                className={cn(inputClassName, "min-h-24 resize-y leading-6")}
              />
            </Field>
          </SectionBlock>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-24">
          <VoucherPreview preview={preview} />

          <div className="rounded-[1.15rem] border border-white/10 bg-[#181519] p-3.5 shadow-[0_18px_42px_rgba(0,0,0,0.22)]">
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-full bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-[var(--color-accent-contrast)] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? "Vytvářím..." : "Vytvořit voucher"}
            </button>
            <Link
              href={data.listHref}
              className="mt-2 flex w-full items-center justify-center rounded-full border border-white/10 px-5 py-3 text-sm text-white/78 transition hover:border-white/18 hover:bg-white/6"
            >
              Zpět na seznam
            </Link>
          </div>
        </aside>
      </div>
    </form>
  );
}

function TypeButton({
  active,
  label,
  description,
  badge,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-28 rounded-[1.1rem] border px-4 py-3 text-left transition",
        active
          ? "border-[var(--color-accent)]/60 bg-[rgba(190,160,120,0.18)] text-white shadow-[0_0_0_1px_rgba(190,160,120,0.12)]"
          : "border-white/10 bg-[#171419] text-white/68 hover:border-white/18 hover:bg-[#1d1920]",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-white">{label}</span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em]",
            active
              ? "border-[var(--color-accent)]/45 text-[var(--color-accent-soft)]"
              : "border-white/8 text-white/38",
          )}
        >
          {badge}
        </span>
      </span>
      <span className="mt-2 block text-sm leading-5 text-white/56">{description}</span>
    </button>
  );
}

function ServicePreview({
  service,
}: {
  service: AdminVoucherCreatePageData["services"][number] | null;
}) {
  if (!service) {
    return (
      <div className="rounded-[1.1rem] border border-dashed border-white/14 bg-[#171419] p-4 text-sm leading-6 text-white/62">
        Nejdřív založte nebo aktivujte službu v katalogu.
      </div>
    );
  }

  return (
    <dl className="grid gap-2 rounded-[1.1rem] border border-white/8 bg-[#171419] p-3 text-sm">
      <PreviewRow label="Služba" value={service.publicName ?? service.name} />
      <PreviewRow label="Cena" value={service.priceFromCzk === null ? "Neuvedeno" : czkFormatter.format(service.priceFromCzk)} />
      <PreviewRow label="Délka" value={`${service.durationMinutes} min`} />
    </dl>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.18em] text-white/42">{label}</dt>
      <dd className="mt-1 text-white/84">{value}</dd>
    </div>
  );
}

function SectionBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.2rem] border border-white/8 bg-[#151317] p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.2em] text-white/50">{label}</span>
      {children}
      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
    </label>
  );
}

type VoucherPreviewData = {
  typeLabel: string;
  headline: string;
  subline: string;
  validityLabel: string;
  purchaserLabel: string;
};

function VoucherPreview({
  preview,
}: {
  preview: VoucherPreviewData;
}) {
  return (
    <section className="overflow-hidden rounded-[1.15rem] border border-[var(--color-accent)]/22 bg-[linear-gradient(145deg,rgba(190,160,120,0.18),rgba(21,19,23,0.98))] shadow-[0_18px_42px_rgba(0,0,0,0.22)]">
      <div className="border-b border-white/8 p-4">
        <p className="text-[0.64rem] uppercase tracking-[0.22em] text-[var(--color-accent-soft)]">
          Náhled voucheru
        </p>
        <p className="mt-3 font-display text-2xl leading-tight text-white">{preview.headline}</p>
        <p className="mt-2 text-sm leading-5 text-white/62">{preview.subline}</p>
      </div>
      <dl className="grid gap-2 p-4">
        <PreviewRow label="Typ" value={preview.typeLabel} />
        <PreviewRow label="Platnost" value={preview.validityLabel} />
        <PreviewRow label="Kupující" value={preview.purchaserLabel} />
      </dl>
    </section>
  );
}

function buildVoucherPreview({
  type,
  originalValueCzk,
  selectedService,
  validFrom,
  validUntil,
  purchaserName,
}: {
  type: VoucherType;
  originalValueCzk: string;
  selectedService: AdminVoucherCreatePageData["services"][number] | null;
  validFrom: string;
  validUntil: string;
  purchaserName: string;
}): VoucherPreviewData {
  if (type === VoucherType.SERVICE) {
    const serviceName = selectedService?.publicName ?? selectedService?.name ?? "Vyberte službu";

    return {
      typeLabel: "Poukaz na službu",
      headline: serviceName,
      subline:
        selectedService?.priceFromCzk === null || selectedService?.priceFromCzk === undefined
          ? "Cena služby není vyplněná."
          : `${czkFormatter.format(selectedService.priceFromCzk)} • ${selectedService.durationMinutes} min`,
      validityLabel: formatDateRange(validFrom, validUntil),
      purchaserLabel: purchaserName.trim() || "Neuvedeno",
    };
  }

  const parsedValue = Number(originalValueCzk);

  return {
    typeLabel: "Hodnotový poukaz",
    headline: Number.isFinite(parsedValue) && parsedValue > 0 ? czkFormatter.format(parsedValue) : "Zadejte hodnotu",
    subline: "Čerpání po částkách při návštěvě v salonu.",
    validityLabel: formatDateRange(validFrom, validUntil),
    purchaserLabel: purchaserName.trim() || "Neuvedeno",
  };
}

function formatDateRange(validFrom: string, validUntil: string) {
  return `${formatDateInput(validFrom)} - ${formatDateInput(validUntil)}`;
}

function formatDateInput(value: string) {
  if (!value) {
    return "Nevyplněno";
  }

  const [year, month, day] = value.split("-");

  return year && month && day ? `${Number(day)}. ${Number(month)}. ${year}` : value;
}

const inputClassName =
  "mt-2 w-full rounded-[1rem] border border-white/10 bg-[#0f0d12] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[var(--color-accent)]/65";
