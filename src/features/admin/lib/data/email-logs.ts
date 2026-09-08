import { BookingActionTokenType, AvailabilitySlotStatus, BookingStatus, BookingSubmissionOutcome, EmailIncidentManualResolutionReason, EmailIncidentResolutionKind, EmailLogStatus, EmailLogType, Prisma } from "@/generated/prisma/client";

import type { AdminArea } from "@/config/navigation";
import { getDayBounds, isValidDateKey } from "@/features/admin/lib/admin-slots/time";
import { getAdminBookingHref } from "@/features/admin/lib/booking/booking-display";
import { formatServicePrice } from "@/features/admin/lib/admin-service-format";
import { formatClientPhoneForDisplay } from "@/features/booking/lib/client-phone";
import { getEmailWorkerStaleBefore, isEmailWorkerClaimStale } from "@/lib/email/booking-delivery-fence";
import { deriveTrackingState } from "@/lib/email/resend-webhooks";
import { getEmailDeliveryFailureWhere, getUnresolvedEmailDeliveryFailureWhere, getUnresolvedEmailDeliveryIncidentRootWhere, isEmailDeliveryFailure } from "@/lib/email/incidents";
import { prisma } from "@/lib/prisma";

export { getEmailDeliveryFailureWhere, getEmailDeliveryIncidentRootWhere, getUnresolvedEmailDeliveryFailureWhere, getUnresolvedEmailDeliveryIncidentRootWhere } from "@/lib/email/incidents";

const formatTime = new Intl.DateTimeFormat("cs-CZ", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Prague",
});

const formatDateTime = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Prague",
});

function formatDateTimeLabel(value: Date | null | undefined): string {
  if (!value) {
    return "Bez času";
  }

  return formatDateTime.format(value);
}

function manualIncidentResolutionReasonLabel(reason: EmailIncidentManualResolutionReason | null) {
  switch (reason) {
    case EmailIncidentManualResolutionReason.HISTORICAL:
      return "Historický";
    case EmailIncidentManualResolutionReason.CONTACTED_OTHER_WAY:
      return "Kontaktována jinak";
    case EmailIncidentManualResolutionReason.NO_LONGER_RELEVANT:
      return "Již nerelevantní";
    case EmailIncidentManualResolutionReason.OTHER:
      return "Jiný důvod";
    default:
      return "Bez uvedeného důvodu";
  }
}

function formatTimeRange(startsAt: Date, endsAt: Date): string {
  return `${formatDateTimeLabel(startsAt)} - ${formatTime.format(endsAt)}`;
}

function statusLabel(status: BookingStatus | AvailabilitySlotStatus | EmailLogStatus): string {
  switch (status) {
    case BookingStatus.PENDING:
      return "Čeká";
    case BookingStatus.CONFIRMED:
      return "Potvrzeno";
    case BookingStatus.CANCELLED:
      return "Zrušeno";
    case BookingStatus.COMPLETED:
      return "Hotovo";
    case BookingStatus.NO_SHOW:
      return "Nedorazila";
    case AvailabilitySlotStatus.DRAFT:
      return "Draft";
    case AvailabilitySlotStatus.PUBLISHED:
      return "Publikováno";
    case AvailabilitySlotStatus.CANCELLED:
      return "Zrušeno";
    case AvailabilitySlotStatus.ARCHIVED:
      return "Archiv";
    case EmailLogStatus.PENDING:
      return "Čeká";
    case EmailLogStatus.SENT:
      return "Odesláno";
    case EmailLogStatus.FAILED:
      return "Chyba";
    default:
      return String(status);
  }
}

function retryStateLabel(
  nextAttemptAt: Date | null,
  processingStartedAt: Date | null,
  attemptCount: number,
): string {
  if (processingStartedAt) {
    return `Zpracovává se • pokus ${attemptCount}`;
  }

  if (attemptCount > 0) {
    return `Retry • další pokus ${formatDateTimeLabel(nextAttemptAt)}`;
  }

  return `Ve frontě • další pokus ${formatDateTimeLabel(nextAttemptAt)}`;
}

type EmailTrackingInput = Parameters<typeof deriveTrackingState>[0];

export function getEmailDetailFinalStatus(input: {
  status: EmailLogStatus;
  sentAt: Date | null;
  processingStartedAt: Date | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  updatedAt: Date;
} & EmailTrackingInput): {
  value: "sent" | "pending" | "retry" | "failed";
  label: string;
  detail: string;
  needsAttention: boolean;
} {
  const tracking = deriveTrackingState(input);

  if (tracking.value === "failed") {
    return {
      value: "failed" as const,
      label: "Nedoručeno",
      detail: input.trackingBouncedAt
        ? "Odmítnuto cílovým serverem (bounce)"
        : tracking.label,
      needsAttention: true,
    };
  }

  if (tracking.value === "retry") {
    const isComplaint = input.trackingComplainedAt !== null;

    return {
      value: "retry" as const,
      label: isComplaint ? "Nahlášeno jako spam" : "Doručení vyžaduje pozornost",
      detail: tracking.label,
      needsAttention: true,
    };
  }

  if (input.sentAt) {
    return {
      value: "sent" as const,
      label: "Odesláno",
      detail: `Odeslání providerovi úspěšné ${formatDateTimeLabel(input.sentAt)}`,
      needsAttention: false,
    };
  }

  if (input.attemptCount > 0 && input.status !== EmailLogStatus.FAILED) {
    return {
      value: "retry" as const,
      label: "Retry",
      detail: input.processingStartedAt
        ? `Probíhá další pokus od ${formatDateTimeLabel(input.processingStartedAt)}`
        : `Další pokus ${formatDateTimeLabel(input.nextAttemptAt)}`,
      needsAttention: true,
    };
  }

  if (input.status === EmailLogStatus.FAILED) {
    return {
      value: "failed" as const,
      label: "Selhalo",
      detail: `Poslední pokus ${formatDateTimeLabel(input.processingStartedAt ?? input.updatedAt)}`,
      needsAttention: true,
    };
  }

  return {
    value: "pending" as const,
    label: "Čeká",
    detail: input.processingStartedAt
      ? `První pokus běží od ${formatDateTimeLabel(input.processingStartedAt)}`
      : `Ve frontě od ${formatDateTimeLabel(input.nextAttemptAt)}`,
    needsAttention: false,
  };
}

function getErrorSummary(errorMessage: string | null) {
  if (!errorMessage) {
    return null;
  }

  const summary = errorMessage
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return summary ?? "Chyba bez detailu.";
}

function emailTypeLabel(type: EmailLogType, templateKey: string): string {
  if (templateKey === "booking-confirmation-v1") {
    return "Přijetí rezervace";
  }

  if (templateKey === "booking-approved-v1") {
    return "Potvrzení rezervace";
  }

  switch (type) {
    case EmailLogType.BOOKING_CREATED:
      return "Notifikace nové rezervace";
    case EmailLogType.BOOKING_RECEIVED:
      return "Přijetí rezervace";
    case EmailLogType.BOOKING_CONFIRMED:
      return "Potvrzení rezervace";
    case EmailLogType.BOOKING_CANCELLED:
      return "Storno potvrzení";
    case EmailLogType.BOOKING_RESCHEDULED:
      return "Přesun termínu";
    case EmailLogType.BOOKING_REMINDER:
      return "Připomínka termínu";
    case EmailLogType.VOUCHER_SENT:
      return "Odeslání voucheru";
    case EmailLogType.GENERIC:
      return "Obecný e-mail";
  }

  return "Neznámý typ e-mailu";
}

function actionTokenTypeLabel(type: BookingActionTokenType): string {
  switch (type) {
    case BookingActionTokenType.CANCEL:
      return "Storno token";
    case BookingActionTokenType.RESCHEDULE:
      return "Přesun termínu";
    case BookingActionTokenType.APPROVE:
      return "Schválení z e-mailu";
    case BookingActionTokenType.REJECT:
      return "Zrušení z e-mailu";
  }

  return "Neznámý action token";
}

export function getEmailLogSeverity(input: {
  status: EmailLogStatus;
  processingStartedAt: Date | null;
  attemptCount: number;
  staleBefore: Date;
} & EmailTrackingInput): AdminLogSeverity {
  const tracking = deriveTrackingState(input);

  if (tracking.value === "failed" || input.status === EmailLogStatus.FAILED) return "error";
  if (tracking.value === "retry") return "warning";
  if (input.processingStartedAt && input.processingStartedAt < input.staleBefore) return "warning";
  if (input.attemptCount > 0 && input.status === EmailLogStatus.PENDING) return "warning";
  return input.status === EmailLogStatus.SENT ? "success" : "info";
}

type EmailRecentStatusValue = "sent" | "pending" | "processing" | "retry" | "failed";

export type EmailLogDetailData = {
  id: string;
  status: EmailLogStatus;
  statusLabel: string;
  finalStatus: "sent" | "pending" | "retry" | "failed";
  finalStatusLabel: string;
  finalStatusDetail: string;
  statusNeedsAttention: boolean;
  type: EmailLogType;
  typeLabel: string;
  recipientEmail: string;
  subject: string;
  businessTitle: string;
  templateKey: string;
  attemptCount: number;
  queueStateLabel: string;
  isProcessing: boolean;
  isStuck: boolean;
  canRetry: boolean;
  canRelease: boolean;
  nextAttemptLabel: string;
  processingStartedLabel: string;
  sentAtLabel: string;
  createdAtLabel: string;
  updatedAtLabel: string;
  providerLabel: string;
  providerMessageIdLabel: string;
  transportStatusLabel: string;
  deliveryStatusLabel: string;
  errorMessage: string | null;
  errorSummary: string | null;
  payload: Prisma.JsonValue | null;
  bookingSummary: string;
  bookingHref: string | null;
  bookingTitle: string;
  bookingScheduleLabel: string;
  clientName: string;
  clientSummary: string;
  clientContactEmail: string | null;
  canResend: boolean;
  canCloseIncident: boolean;
  incidentResolution: {
    label: string;
    detail: string;
  } | null;
  actionTokenId: string | null;
  actionTokenLabel: string;
  actionTokenSummary: string;
  lastAttemptLabel: string;
  headerTimestampLabel: string;
  headerTimestampTitle: string;
};

function getEmailRecentStatus(
  status: EmailLogStatus,
  processingStartedAt: Date | null,
  attemptCount: number,
): EmailRecentStatusValue {
  if (status === EmailLogStatus.SENT) {
    return "sent";
  }

  if (status === EmailLogStatus.FAILED) {
    return "failed";
  }

  if (processingStartedAt) {
    return "processing";
  }

  if (attemptCount > 0) {
    return "retry";
  }

  return "pending";
}

function getEmailRecentStatusLabel(
  status: EmailLogStatus,
  processingStartedAt: Date | null,
  attemptCount: number,
): string {
  switch (getEmailRecentStatus(status, processingStartedAt, attemptCount)) {
    case "sent":
      return "Odesláno";
    case "pending":
      return "Čeká";
    case "processing":
      return "Zpracovává se";
    case "retry":
      return "Retry";
    case "failed":
      return "Selhalo";
  }
}

function getWorkerSummary({
  pending,
  retrying,
  processing,
  failed,
}: {
  pending: number;
  retrying: number;
  processing: number;
  failed: number;
}) {
  if (processing > 0) {
    return `Worker právě drží ${processing} ${processing === 1 ? "zprávu" : processing < 5 ? "zprávy" : "zpráv"} v claimu.`;
  }

  if (pending > 0 || retrying > 0) {
    return "Ve frontě jsou čekající zprávy, ale aktuálně není vidět aktivní claim workeru.";
  }

  if (failed > 0) {
    return "Fronta je prázdná, ale zůstávají aktivní e-mailové incidenty k dořešení nebo ručnímu retry.";
  }

  return "Fronta je čistá a worker momentálně nedrží žádný aktivní job.";
}

export type AdminLogView = "attention" | "events" | "emails" | "system";
export type AdminLogSeverity = "info" | "success" | "warning" | "error";
export type AdminLogSource = "all" | "email" | "booking" | "voucher" | "service" | "settings" | "availability" | "admin" | "submission";

export type AdminLogItem = {
  id: string;
  occurredAt: string;
  category: "event" | "email" | "automation" | "system";
  severity: AdminLogSeverity;
  title: string;
  description: string | null;
  actorLabel: string | null;
  entityLabel: string | null;
  entityHref: string | null;
  sourceType: "email" | "booking" | "voucher" | "service" | "settings" | "availability" | "admin" | "submission";
  sourceId: string;
  primaryAction: "retry" | "release" | "detail" | "open" | null;
  emailLogId?: string;
  queueState?: string;
  trackingState?: string;
};

export type AdminLogsData = {
  area: AdminArea;
  view: AdminLogView;
  items: AdminLogItem[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  filters: { query: string; severity: "all" | AdminLogSeverity; source: AdminLogSource; emailType: "all" | EmailLogType; dateFrom: string; dateTo: string };
  attention: { failed: number; retry: number; stuck: number; critical: number };
  queueStats: Array<{
    label: string;
    value: string;
    tone?: "default" | "accent" | "muted";
    detail?: string;
  }>;
  workerSummary: string;
};

const adminLogPageSize = 50;

function bookingHistoryLabel(status: BookingStatus) {
  switch (status) {
    case BookingStatus.PENDING: return "Rezervace vytvořena";
    case BookingStatus.CONFIRMED: return "Rezervace potvrzena";
    case BookingStatus.CANCELLED: return "Rezervace zrušena";
    case BookingStatus.COMPLETED: return "Rezervace dokončena";
    case BookingStatus.NO_SHOW: return "Klientka nedorazila";
  }
}

function bookingHistorySeverity(status: BookingStatus): AdminLogSeverity {
  if (status === BookingStatus.NO_SHOW) return "warning";
  if (status === BookingStatus.COMPLETED || status === BookingStatus.CONFIRMED) return "success";
  return "info";
}

const bookingHistoryAuditSourcePresentation = {
  "admin-booking-price-update-v1": { title: "Cena rezervace upravena", severity: "info" },
  "admin-booking-note-v1": { title: "Interní poznámka upravena", severity: "info" },
  "admin-client-contact-update-v1": { title: "Kontakt klientky upraven", severity: "info" },
  "admin-booking-service-change-v1": { title: "Služba rezervace změněna", severity: "info" },
  "admin-booking-payment-create-v1": { title: "Platba zaznamenána", severity: "info" },
  "admin-booking-payment-update-v1": { title: "Platba upravena", severity: "info" },
  "admin-booking-payment-void-v1": { title: "Platba stornována", severity: "info" },
  "admin-booking-complete-flow-v1": { title: "Platba zaznamenána", severity: "info" },
} as const satisfies Record<string, { title: string; severity: AdminLogSeverity }>;

const bookingHistoryReasonPresentation = {
  "public-booking-request-v1": { title: "Rezervace vytvořena", severity: "info" },
  "admin-manual-booking-v1": { title: "Rezervace vytvořena", severity: "info" },
  "owner-email-approve-v1": { title: "Rezervace potvrzena", severity: "success" },
  "owner-email-reject-v1": { title: "Rezervace zrušena", severity: "info" },
  "public-cancellation-flow-v1": { title: "Rezervace zrušena", severity: "info" },
  "Voucher uplatněn při dokončení návštěvy": { title: "Voucher uplatněn při dokončení návštěvy", severity: "info" },
} as const satisfies Record<string, { title: string; severity: AdminLogSeverity }>;

const bookingHistoryOperationalSources = Object.keys(bookingHistoryAuditSourcePresentation);

function getBookingHistorySource(metadata: Prisma.JsonValue | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return typeof metadata.source === "string" ? metadata.source : null;
}

const voucherCompletionAuditReason = "Voucher uplatněn při dokončení návštěvy";
const voucherCompletionAuditSource = "admin-booking-complete-flow-v1";

function getBookingHistoryVoucherCode(metadata: Prisma.JsonValue | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return typeof metadata.voucherCode === "string" ? metadata.voucherCode : null;
}

type VoucherCompletionBookingAudit = {
  bookingId: string;
  reason: string | null;
  metadata: Prisma.JsonValue | null;
};

type CanonicalVoucherRedemption = {
  bookingId: string | null;
  voucher: { code: string } | null;
};

/** Potlačí jen booking audit, pro který existuje stejná kanonická voucher redemption operace. */
export function filterDuplicateVoucherCompletionAudits<T extends VoucherCompletionBookingAudit>(
  history: T[],
  redemptions: CanonicalVoucherRedemption[],
) {
  const canonicalOperations = new Set(redemptions.flatMap((redemption) => (
    redemption.bookingId && redemption.voucher
      ? [`${redemption.bookingId}\u0000${redemption.voucher.code}`]
      : []
  )));

  return history.filter((entry) => {
    if (entry.reason !== voucherCompletionAuditReason || getBookingHistorySource(entry.metadata) !== voucherCompletionAuditSource) return true;
    const voucherCode = getBookingHistoryVoucherCode(entry.metadata);
    return !voucherCode || !canonicalOperations.has(`${entry.bookingId}\u0000${voucherCode}`);
  });
}

function bookingHistoryReasonLabel(reason: string | null) {
  const labels: Record<string, string> = {
    "public-booking-request-v1": "Rezervace odeslána z online formuláře",
    "owner-email-approve-v1": "Rezervace potvrzena z e-mailu",
    "owner-email-reject-v1": "Rezervace zamítnuta z e-mailu",
    "public-cancellation-flow-v1": "Rezervace zrušena klientkou online",
    "admin-manual-booking-v1": "Rezervace vytvořena ručně v administraci",
  };
  return reason ? labels[reason] ?? reason : null;
}

export function getBookingHistoryPresentation(entry: {
  status: BookingStatus;
  reason: string | null;
  metadata: Prisma.JsonValue | null;
}) {
  const reasonPresentation = entry.reason ? bookingHistoryReasonPresentation[entry.reason as keyof typeof bookingHistoryReasonPresentation] : null;
  if (reasonPresentation) {
    return { ...reasonPresentation, description: bookingHistoryReasonLabel(entry.reason) };
  }

  const source = getBookingHistorySource(entry.metadata);
  const sourcePresentation = source ? bookingHistoryAuditSourcePresentation[source as keyof typeof bookingHistoryAuditSourcePresentation] : null;
  if (sourcePresentation) {
    return { ...sourcePresentation, description: bookingHistoryReasonLabel(entry.reason) };
  }

  return {
    title: bookingHistoryLabel(entry.status),
    severity: bookingHistorySeverity(entry.status),
    description: bookingHistoryReasonLabel(entry.reason),
  };
}

const adminSubmissionPrefixes = ["ADMIN_LOGIN_", "ADMIN_INVITE_ACTIVATION_", "ADMIN_RECOVERY_"] as const;
const publicVoucherSubmissionPrefix = "PUBLIC_VOUCHER_VERIFY_";
const expectedBookingFailureCodes = [
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "SERVICE_UNAVAILABLE",
  "SLOT_UNAVAILABLE",
  "SLOT_NOT_ALLOWED",
  "SLOT_TOO_SHORT",
  "SLOT_ALREADY_BOOKED_BY_CLIENT",
  "VOUCHER_INVALID",
  "BOOKING_CONFLICT",
] as const;
const criticalBookingFailureCodes = ["TEMPORARY_FAILURE", "SCHEMA_MISMATCH", "UNEXPECTED_ERROR"] as const;

export function isCriticalBookingSubmission(failureCode: string | null) {
  return criticalBookingFailureCodes.some((code) => code === failureCode)
    || (failureCode?.startsWith(publicVoucherSubmissionPrefix) === true && failureCode.endsWith("_UNKNOWN_ERROR"));
}

export function getBookingSubmissionPresentation(entry: {
  outcome: BookingSubmissionOutcome;
  failureCode: string | null;
}) {
  const { failureCode, outcome } = entry;
  if (failureCode?.startsWith("ADMIN_LOGIN_")) {
    return { title: "Přihlášení administrátora", severity: "info" as const, entityFallback: "Administrace", needsAttention: false };
  }
  if (failureCode?.startsWith("ADMIN_INVITE_ACTIVATION_")) {
    return { title: "Aktivace přístupu", severity: "info" as const, entityFallback: "Administrátorský přístup", needsAttention: false };
  }
  if (failureCode?.startsWith("ADMIN_RECOVERY_")) {
    return { title: "Obnova administrátora", severity: "info" as const, entityFallback: "Administrace", needsAttention: false };
  }
  if (failureCode?.startsWith(publicVoucherSubmissionPrefix)) {
    const needsAttention = isCriticalBookingSubmission(failureCode);
    return { title: "Veřejné ověření voucheru", severity: needsAttention ? "error" as const : "info" as const, entityFallback: "Voucher", needsAttention };
  }

  const expectedFailure = expectedBookingFailureCodes.some((code) => code === failureCode);
  const needsAttention = isCriticalBookingSubmission(failureCode);
  const severity: AdminLogSeverity = needsAttention || (outcome === BookingSubmissionOutcome.FAILED && !expectedFailure)
    ? "error"
    : outcome === BookingSubmissionOutcome.SUCCESS
      ? "success"
      : "info";
  const title = outcome === BookingSubmissionOutcome.SUCCESS
    ? "Rezervace úspěšně odeslána"
    : outcome === BookingSubmissionOutcome.BLOCKED
      ? "Odeslání rezervace zablokováno"
      : "Odeslání rezervace selhalo";
  return { title, severity, entityFallback: "Veřejný booking", needsAttention };
}

function criticalBookingSubmissionWhere(createdAt?: Prisma.DateTimeFilter): Prisma.BookingSubmissionLogWhereInput {
  return {
    outcome: BookingSubmissionOutcome.FAILED,
    ...(createdAt ? { createdAt } : {}),
    OR: [
      { failureCode: { in: [...criticalBookingFailureCodes] } },
      { failureCode: { startsWith: publicVoucherSubmissionPrefix, endsWith: "_UNKNOWN_ERROR" } },
    ],
  };
}

function parseLogDate(value: string | undefined, end = false) {
  if (!value || !isValidDateKey(value)) return null;
  const { startsAt, endsAt } = getDayBounds(value);
  return end ? endsAt : startsAt;
}

function containsQuery(value: string): Prisma.StringFilter {
  return { contains: value, mode: "insensitive" };
}

export function buildEmailLogWhere(query: string, dateWhere?: Prisma.DateTimeFilter, emailType: "all" | EmailLogType = "all"): Prisma.EmailLogWhereInput {
  return {
    ...(dateWhere ? { createdAt: dateWhere } : {}),
    ...(emailType !== "all" ? { type: emailType } : {}),
    ...(query ? { OR: [
      { recipientEmail: containsQuery(query) }, { subject: containsQuery(query) },
      { templateKey: containsQuery(query) },
      { booking: { is: { OR: [{ clientNameSnapshot: containsQuery(query) }, { serviceNameSnapshot: containsQuery(query) }, { id: containsQuery(query) }] } } },
      { client: { is: { fullName: containsQuery(query) } } },
    ] } : {}),
  };
}

function getEmailDeliveryWarningWhere(): Prisma.EmailLogWhereInput {
  return {
    OR: [
      { trackingComplainedAt: { not: null } },
      {
        trackingLastEvent: "email.delivery_delayed",
        trackingDeliveredAt: null,
        trackingOpenedAt: null,
        trackingClickedAt: null,
      },
    ],
  };
}

export function buildBookingHistoryWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.BookingStatusHistoryWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    { reason: containsQuery(query) }, { note: containsQuery(query) },
    { booking: { is: { OR: [{ id: containsQuery(query) }, { clientNameSnapshot: containsQuery(query) }, { serviceNameSnapshot: containsQuery(query) }] } } },
  ] } : {}) };
}

export function buildAvailabilityAuditWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.AvailabilityAuditEventWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    { dateKey: containsQuery(query) }, { source: containsQuery(query) }, { operationId: containsQuery(query) },
    { actorUser: { is: { name: containsQuery(query) } } },
  ] } : {}) };
}

function availabilityAuditLabel(operation: string) {
  return ({ ADD: "Dostupnost přidána", REMOVE: "Dostupnost odebrána", CLEAR: "Dostupnost dne vyčištěna", COPY_WEEK: "Týden dostupnosti zkopírován", APPLY_TEMPLATE: "Použita šablona týdne", SYNC_DRAFT: "Publikován koncept týdne", UNDO: "Změna dostupnosti vrácena" } as Record<string, string>)[operation] ?? "Dostupnost upravena";
}

function availabilityAuditDescription(entry: { dateKey: string; before: Prisma.JsonValue; after: Prisma.JsonValue; revertedOperationId: string | null }) {
  const before = (entry.before as { intervals?: Array<{ startsAt: string; endsAt: string }> }).intervals ?? [];
  const after = (entry.after as { intervals?: Array<{ startsAt: string; endsAt: string }> }).intervals ?? [];
  const label = (intervals: Array<{ startsAt: string; endsAt: string }>) => intervals.map((item) => `${formatTime.format(new Date(item.startsAt))}–${formatTime.format(new Date(item.endsAt))}`).join(", ") || "bez dostupnosti";
  return `${entry.dateKey}: ${label(before)} → ${label(after)}${entry.revertedOperationId ? " • vrácení předchozí operace" : ""}`;
}

function buildRescheduleWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.BookingRescheduleLogWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    { reason: containsQuery(query) }, { booking: { is: { OR: [{ id: containsQuery(query) }, { clientNameSnapshot: containsQuery(query) }, { serviceNameSnapshot: containsQuery(query) }] } } },
  ] } : {}) };
}

export function buildVoucherWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.VoucherWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    { code: containsQuery(query) }, { purchaserName: containsQuery(query) }, { purchaserEmail: containsQuery(query) }, { recipientName: containsQuery(query) },
  ] } : {}) };
}

function buildVoucherRedemptionWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.VoucherRedemptionWhereInput {
  return { ...(dateWhere ? { redeemedAt: dateWhere } : {}), ...(query ? { OR: [
    { voucher: { is: { code: containsQuery(query) } } },
    { booking: { is: { OR: [{ id: containsQuery(query) }, { clientNameSnapshot: containsQuery(query) }] } } },
  ] } : {}) };
}

function buildVoucherChangeWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.VoucherChangeLogWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    { voucher: { is: { code: containsQuery(query) } } },
    { actorUser: { is: { name: containsQuery(query) } } },
  ] } : {}) };
}

function buildServiceChangeWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.ServiceChangeLogWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    { service: { is: { OR: [{ name: containsQuery(query) }, { publicName: containsQuery(query) }] } } },
    { actorUser: { is: { name: containsQuery(query) } } },
  ] } : {}) };
}

function buildServicePriceChangeWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.ServicePriceChangeLogWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    { service: { is: { OR: [{ name: containsQuery(query) }, { publicName: containsQuery(query) }] } } },
    { changedByUser: { is: { name: containsQuery(query) } } },
  ] } : {}) };
}

function buildSiteSettingsChangeWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.SiteSettingsChangeLogWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? {
    actorUser: { is: { name: containsQuery(query) } },
  } : {}) };
}

function buildAdminUserAuditWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.AdminUserAuditEventWhereInput {
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    { targetUser: { is: { OR: [{ name: containsQuery(query) }, { email: containsQuery(query) }] } } },
    { actorUser: { is: { name: containsQuery(query) } } },
  ] } : {}) };
}

function auditValueLabel(value: Prisma.JsonValue | undefined) {
  if (value === null || value === undefined) return "neuvedeno";
  if (typeof value === "boolean") return value ? "Ano" : "Ne";
  if (Array.isArray(value)) return value.join(", ") || "žádné";
  return String(value);
}

function categoryAuditValueLabel(value: Prisma.JsonValue | undefined, categoryNames: Map<string, string>) {
  if (typeof value === "string") return categoryNames.get(value) ?? value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return auditValueLabel(value);
  const snapshot = value as Record<string, Prisma.JsonValue>;
  if (typeof snapshot.categoryName === "string" && snapshot.categoryName) return snapshot.categoryName;
  if (typeof snapshot.categoryId === "string") return categoryNames.get(snapshot.categoryId) ?? snapshot.categoryId;
  return auditValueLabel(value);
}

function auditChangeDescription(
  beforeValue: Prisma.JsonValue,
  afterValue: Prisma.JsonValue,
  categoryNames = new Map<string, string>(),
) {
  const before = beforeValue && typeof beforeValue === "object" && !Array.isArray(beforeValue) ? beforeValue : {};
  const after = afterValue && typeof afterValue === "object" && !Array.isArray(afterValue) ? afterValue : {};
  const labels: Record<string, string> = {
    role: "Role", isActive: "Aktivní", validUntil: "Platnost do", status: "Stav",
    cancelledAt: "Zrušeno", hasInternalNote: "Interní poznámka", categoryId: "Kategorie",
    purchaserNameChanged: "Jméno kupujícího", purchaserEmailChanged: "E-mail kupujícího",
    internalNoteChanged: "Interní poznámka",
    name: "Název", publicName: "Veřejný název", seoTitle: "SEO titulek",
    durationMinutes: "Délka", cleanupMinutes: "Úklid", sortOrder: "Pořadí",
    isFeaturedOnHomepage: "Na homepage", homepageSortOrder: "Pořadí na homepage",
    isPubliclyBookable: "Rezervovatelná", publicContentFields: "Veřejný obsah",
    bookingMinAdvanceHours: "Minimální předstih", bookingMaxAdvanceDays: "Maximální předstih",
    bookingCancellationHours: "Storno lhůta", salonName: "Název salonu", addressLine: "Adresa",
    city: "Město", postalCode: "PSČ", phone: "Telefon", contactEmail: "Kontaktní e-mail",
    instagramUrl: "Instagram", voucherPdfLogoMediaId: "Logo voucheru",
    notificationAdminEmail: "Notifikační e-mail", emailSenderName: "Jméno odesílatele",
    emailSenderEmail: "E-mail odesílatele", hasEmailFooter: "Patička e-mailu",
  };
  return Object.keys(after).map((key) => {
    const label = labels[key] ?? key.replace(/Changed$/, "");
    if (key.endsWith("Changed") && after[key] === true) return `${label}: upraveno`;
    const suffix = key.endsWith("Minutes") ? " min" : key.endsWith("Hours") ? " h" : key.endsWith("Days") ? " dní" : "";
    const beforeLabel = key === "categoryId"
      ? categoryAuditValueLabel(before[key], categoryNames)
      : auditValueLabel(before[key]);
    const afterLabel = key === "categoryId"
      ? categoryAuditValueLabel(after[key], categoryNames)
      : auditValueLabel(after[key]);
    return `${label}: ${beforeLabel}${suffix} → ${afterLabel}${suffix}`;
  }).join(" • ");
}

export function buildBookingSubmissionWhere(query: string, dateWhere?: Prisma.DateTimeFilter): Prisma.BookingSubmissionLogWhereInput {
  const outcome = ["SUCCESS", "FAILED", "BLOCKED"].includes(query.toUpperCase())
    ? query.toUpperCase() as BookingSubmissionOutcome
    : undefined;
  return { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(query ? { OR: [
    ...(outcome ? [{ outcome: { equals: outcome } }] : []),
    { failureCode: containsQuery(query) }, { failureReason: containsQuery(query) },
    { booking: { is: { OR: [{ id: containsQuery(query) }, { clientNameSnapshot: containsQuery(query) }, { serviceNameSnapshot: containsQuery(query) }] } } },
    { client: { is: { fullName: containsQuery(query) } } },
  ] } : {}) };
}

export function withBookingSubmissionSeverity(base: Prisma.BookingSubmissionLogWhereInput, severity: "all" | AdminLogSeverity) {
  if (severity === "all") return base;
  const adminScope: Prisma.BookingSubmissionLogWhereInput = {
    OR: adminSubmissionPrefixes.map((prefix) => ({ failureCode: { startsWith: prefix } })),
  };
  const voucherErrorScope: Prisma.BookingSubmissionLogWhereInput = {
    failureCode: { startsWith: publicVoucherSubmissionPrefix, endsWith: "_UNKNOWN_ERROR" },
  };
  const scopes: Record<AdminLogSeverity, Prisma.BookingSubmissionLogWhereInput> = {
    info: { OR: [
      adminScope,
      { failureCode: { startsWith: publicVoucherSubmissionPrefix, not: { endsWith: "_UNKNOWN_ERROR" } } },
      { outcome: BookingSubmissionOutcome.BLOCKED },
      { outcome: BookingSubmissionOutcome.FAILED, failureCode: { in: [...expectedBookingFailureCodes] } },
    ] },
    success: {
      outcome: BookingSubmissionOutcome.SUCCESS,
      OR: [
        { failureCode: null },
        { NOT: { OR: [...adminSubmissionPrefixes.map((prefix) => ({ failureCode: { startsWith: prefix } })), { failureCode: { startsWith: publicVoucherSubmissionPrefix } }] } },
      ],
    },
    warning: { id: "__no_match__" },
    error: { OR: [
      voucherErrorScope,
      {
        outcome: BookingSubmissionOutcome.FAILED,
        NOT: { OR: [adminScope, { failureCode: { startsWith: publicVoucherSubmissionPrefix } }, { failureCode: { in: [...expectedBookingFailureCodes] } }] },
      },
    ] },
  };
  return { AND: [base, scopes[severity]] } satisfies Prisma.BookingSubmissionLogWhereInput;
}

export function withEmailLogScope(
  base: Prisma.EmailLogWhereInput,
  view: AdminLogView,
  severity: "all" | AdminLogSeverity,
  staleBefore: Date,
): Prisma.EmailLogWhereInput {
  const deliveryFailure = getEmailDeliveryFailureWhere();
  const unresolvedDeliveryFailure = getUnresolvedEmailDeliveryFailureWhere();
  const deliveryWarning = getEmailDeliveryWarningWhere();
  const attention: Prisma.EmailLogWhereInput = { OR: [
    unresolvedDeliveryFailure,
    deliveryWarning,
    { status: EmailLogStatus.PENDING, attemptCount: { gt: 0 }, processingStartedAt: null },
    { status: EmailLogStatus.PENDING, processingStartedAt: { lt: staleBefore } },
  ] };
  const bySeverity: Record<AdminLogSeverity, Prisma.EmailLogWhereInput> = {
    error: view === "attention" ? unresolvedDeliveryFailure : deliveryFailure,
    success: { AND: [{ status: EmailLogStatus.SENT }, { NOT: [deliveryFailure, deliveryWarning] }] },
    warning: { AND: [{ NOT: [deliveryFailure] }, { OR: [
      deliveryWarning,
      { status: EmailLogStatus.PENDING, OR: [{ attemptCount: { gt: 0 } }, { processingStartedAt: { lt: staleBefore } }] },
    ] }] },
    info: { status: EmailLogStatus.PENDING, attemptCount: 0, OR: [{ processingStartedAt: null }, { processingStartedAt: { gte: staleBefore } }] },
  };
  const scopes = [base];
  if (view === "attention") scopes.push(attention);
  if (severity !== "all") scopes.push(bySeverity[severity]);
  return scopes.length === 1 ? base : { AND: scopes };
}

function withBookingHistorySeverity(base: Prisma.BookingStatusHistoryWhereInput, severity: "all" | AdminLogSeverity) {
  if (severity === "all") return base;
  const operationalSource: Prisma.BookingStatusHistoryWhereInput = {
    OR: bookingHistoryOperationalSources.map((source) => ({ metadata: { path: ["source"], equals: source } })),
  };
  const creationReason = { reason: { in: ["public-booking-request-v1", "admin-manual-booking-v1"] } } satisfies Prisma.BookingStatusHistoryWhereInput;
  const scopes: Record<AdminLogSeverity, Prisma.BookingStatusHistoryWhereInput> = {
    info: { OR: [{ status: { in: [BookingStatus.PENDING, BookingStatus.CANCELLED] } }, operationalSource, creationReason] },
    success: { AND: [{ status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } }, { NOT: [operationalSource, creationReason] }] },
    warning: { AND: [{ status: BookingStatus.NO_SHOW }, { NOT: [operationalSource] }] },
    error: { id: "__no_match__" },
  };
  return { AND: [base, scopes[severity]] } satisfies Prisma.BookingStatusHistoryWhereInput;
}

export function normalizeAdminLogView(view: string | undefined, area: AdminArea): AdminLogView {
  const parsed: AdminLogView = ["attention", "events", "emails", "system"].includes(view ?? "")
    ? view as AdminLogView
    : "events";
  return area === "salon" && parsed === "system" ? "events" : parsed;
}

export function sortAndPageAdminLogItems(items: AdminLogItem[], page: number, pageSize = adminLogPageSize) {
  const sorted = [...items].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
  const offset = (page - 1) * pageSize;
  return sorted.slice(offset, offset + pageSize);
}

export function getAdminLogPageMeta(total: number, requestedPage: number, pageSize = adminLogPageSize) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pageCount) : 1;
  return { page, pageCount, rangeStart: total === 0 ? 0 : (page - 1) * pageSize + 1, rangeEnd: Math.min(page * pageSize, total) };
}

export function getAdminLogCandidatePlan(total: number, requestedPage: number, pageSize = adminLogPageSize) {
  const meta = getAdminLogPageMeta(total, requestedPage, pageSize);
  const offset = (meta.page - 1) * pageSize;
  return { ...meta, offset, take: offset + pageSize + 1 };
}

/** Sjednocuje celý read-model na serveru; historické tabulky se do klienta neposílají. */
export async function getAdminLogsData(input: {
  area: AdminArea;
  view?: string;
  query?: string;
  severity?: string;
  source?: string;
  emailType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
}): Promise<AdminLogsData> {
  const isOwner = input.area === "owner";
  const safeView = normalizeAdminLogView(input.view, input.area);
  const severity = ["info", "success", "warning", "error"].includes(input.severity ?? "")
    ? input.severity as AdminLogSeverity : "all";
  const source: AdminLogSource = ["email", "booking", "voucher", "service", "settings", "availability", "admin", "submission"].includes(input.source ?? "")
    ? input.source as AdminLogSource : "all";
  const emailType = Object.values(EmailLogType).includes(input.emailType as EmailLogType)
    ? input.emailType as EmailLogType : "all";
  const query = input.query?.trim().slice(0, 120) ?? "";
  const dateFrom = parseLogDate(input.dateFrom);
  const dateTo = parseLogDate(input.dateTo, true);
  const requestedPage = Number.parseInt(input.page ?? "1", 10);
  const now = new Date();
  const staleBefore = getEmailWorkerStaleBefore(now);
  const attentionSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dateWhere = dateFrom || dateTo ? { gte: dateFrom ?? undefined, lt: dateTo ?? undefined } : undefined;
  const emailActive = (safeView === "emails" || safeView === "attention") && (source === "all" || source === "email");
  const bookingActive = safeView === "events" && (source === "all" || source === "booking");
  const voucherActive = safeView === "events" && (source === "all" || source === "voucher");
  const serviceActive = safeView === "events" && (source === "all" || source === "service");
  const settingsActive = isOwner && safeView === "events" && (source === "all" || source === "settings");
  const availabilityActive = safeView === "events" && (source === "all" || source === "availability");
  const adminAuditActive = isOwner && safeView === "system" && (source === "all" || source === "admin");
  const submissionActive = (safeView === "system" || (isOwner && safeView === "attention")) && (source === "all" || source === "submission");
  const emailBaseWhere = buildEmailLogWhere(query, dateWhere, emailType);
  const emailWhere = withEmailLogScope(emailBaseWhere, safeView, severity, staleBefore);
  const attentionIncidentActive = emailActive && safeView === "attention" && (severity === "all" || severity === "error");
  const attentionSupplementActive = emailActive && safeView === "attention" && (severity === "all" || severity === "warning");
  const attentionIncidentWhere = getUnresolvedEmailDeliveryIncidentRootWhere({
    AND: [getEmailDeliveryFailureWhere(), emailBaseWhere],
  });
  // Root určuje identitu i stav resolution. Reprezentant ale musí být failure,
  // který splňuje celý aktivní emailový filtr, aby UI nikdy nezobrazilo jiný log
  // než ten, který incident do filtrovaného výsledku zařadil.
  const attentionRepresentativeFailureWhere: Prisma.EmailLogWhereInput = {
    AND: [getEmailDeliveryFailureWhere(), emailBaseWhere],
  };
  const attentionSupplementWhere: Prisma.EmailLogWhereInput = severity === "all"
    ? { AND: [emailBaseWhere, { NOT: getEmailDeliveryFailureWhere() }, { OR: [
      getEmailDeliveryWarningWhere(),
      { status: EmailLogStatus.PENDING, attemptCount: { gt: 0 }, processingStartedAt: null },
      { status: EmailLogStatus.PENDING, processingStartedAt: { lt: staleBefore } },
    ] }] }
    : withEmailLogScope(emailBaseWhere, "attention", severity, staleBefore);
  const bookingHistoryWhere = withBookingHistorySeverity(buildBookingHistoryWhere(query, dateWhere), severity);
  const rescheduleWhere = severity === "all" || severity === "info" ? buildRescheduleWhere(query, dateWhere) : { id: "__no_match__" };
  const voucherWhere = severity === "all" || severity === "info" ? buildVoucherWhere(query, dateWhere) : { id: "__no_match__" };
  const redemptionWhere = severity === "all" || severity === "success" ? buildVoucherRedemptionWhere(query, dateWhere) : { id: "__no_match__" };
  const voucherChangeWhere = severity === "all" || severity === "info" ? buildVoucherChangeWhere(query, dateWhere) : { id: "__no_match__" };
  const serviceChangeWhere = severity === "all" || severity === "info" ? buildServiceChangeWhere(query, dateWhere) : { id: "__no_match__" };
  const servicePriceChangeWhere = severity === "all" || severity === "info" ? buildServicePriceChangeWhere(query, dateWhere) : { id: "__no_match__" };
  const siteSettingsChangeWhere = severity === "all" || severity === "info" ? buildSiteSettingsChangeWhere(query, dateWhere) : { id: "__no_match__" };
  const adminUserAuditWhere = severity === "all" || severity === "info" ? buildAdminUserAuditWhere(query, dateWhere) : { id: "__no_match__" };
  const submissionBaseWhere = buildBookingSubmissionWhere(query, dateWhere);
  const submissionWhere = safeView === "attention"
    ? severity === "all" || severity === "error"
      ? { AND: [submissionBaseWhere, criticalBookingSubmissionWhere({ gte: attentionSince })] }
      : { id: "__no_match__" }
    : withBookingSubmissionSeverity(submissionBaseWhere, severity);
  const availabilityWhere = severity === "all" || severity === "info" ? buildAvailabilityAuditWhere(query, dateWhere) : { id: "__no_match__" };

  // Stránka společného feedu je globální, proto nestačí vzít jednu stránku z
  // každého zdroje. Nejdřív si spočítáme přesnou množinu (včetně potlačených
  // voucher auditů) a teprve potom načítáme omezený prefix každého zdroje.
  // Při řazení podle (čas, id) nemůže položka za tímto prefixem předběhnout
  // požadovanou globální stránku.
  const voucherCompletionAuditWhere: Prisma.BookingStatusHistoryWhereInput = {
    AND: [bookingHistoryWhere, {
      reason: voucherCompletionAuditReason,
      metadata: { path: ["source"], equals: voucherCompletionAuditSource },
    }],
  };
  const eventCounts = safeView === "events" ? await Promise.all([
    bookingActive ? prisma.bookingStatusHistory.count({ where: bookingHistoryWhere }) : Promise.resolve(0),
    bookingActive ? prisma.bookingRescheduleLog.count({ where: rescheduleWhere }) : Promise.resolve(0),
    voucherActive ? prisma.voucher.count({ where: voucherWhere }) : Promise.resolve(0),
    voucherActive ? prisma.voucherRedemption.count({ where: redemptionWhere }) : Promise.resolve(0),
    voucherActive ? prisma.voucherChangeLog.count({ where: voucherChangeWhere }) : Promise.resolve(0),
    serviceActive ? prisma.serviceChangeLog.count({ where: serviceChangeWhere }) : Promise.resolve(0),
    serviceActive ? prisma.servicePriceChangeLog.count({ where: servicePriceChangeWhere }) : Promise.resolve(0),
    settingsActive ? prisma.siteSettingsChangeLog.count({ where: siteSettingsChangeWhere }) : Promise.resolve(0),
    availabilityActive ? prisma.availabilityAuditEvent.count({ where: availabilityWhere }) : Promise.resolve(0),
  ]) : null;
  // Přesný total potřebuje zjistit jen identity potenciálně duplicitních auditů,
  // nikoliv načíst celou tabulku VoucherRedemption.
  const voucherCompletionAudits = bookingActive && safeView === "events"
    ? await prisma.bookingStatusHistory.findMany({ where: voucherCompletionAuditWhere, select: { bookingId: true, metadata: true } })
    : [];
  const voucherCompletionIdentities = voucherCompletionAudits.flatMap((audit) => {
    const voucherCode = getBookingHistoryVoucherCode(audit.metadata);
    return voucherCode ? [{ bookingId: audit.bookingId, voucher: { is: { code: voucherCode } } }] : [];
  });
  const canonicalVoucherCompletions = voucherCompletionIdentities.length > 0
    ? await prisma.voucherRedemption.findMany({ where: { OR: voucherCompletionIdentities }, select: { bookingId: true, voucher: { select: { code: true } } } })
    : [];
  const canonicalVoucherCompletionKeys = new Set(canonicalVoucherCompletions.flatMap((redemption) => (
    redemption.bookingId && redemption.voucher ? [`${redemption.bookingId}\u0000${redemption.voucher.code}`] : []
  )));
  const exactSuppressedVoucherAuditCount = voucherCompletionAudits.filter((audit) => {
    const voucherCode = getBookingHistoryVoucherCode(audit.metadata);
    return voucherCode !== null && canonicalVoucherCompletionKeys.has(`${audit.bookingId}\u0000${voucherCode}`);
  }).length;
  const exactEventTotal = eventCounts ? eventCounts.reduce((total, count) => total + count, 0) - exactSuppressedVoucherAuditCount : null;
  const eventMeta = exactEventTotal === null ? null : getAdminLogCandidatePlan(exactEventTotal, requestedPage);
  // Potlačené audity mohou ležet na hraně stránky; jejich přesný počet je
  // bezpečný overfetch, který zachová uzavření stránky i přes více batchů.
  const candidateTake = eventMeta ? eventMeta.take + exactSuppressedVoucherAuditCount : undefined;

  const attentionHealthActive = safeView === "attention";
  const ownerQueueHealthActive = isOwner;
  const [failed, retry, stuck, pending, processing, critical] = await Promise.all([
    attentionHealthActive || ownerQueueHealthActive ? prisma.emailLog.count({ where: getUnresolvedEmailDeliveryIncidentRootWhere() }) : Promise.resolve(0),
    attentionHealthActive || ownerQueueHealthActive ? prisma.emailLog.count({ where: { status: EmailLogStatus.PENDING, attemptCount: { gt: 0 }, processingStartedAt: null } }) : Promise.resolve(0),
    attentionHealthActive || ownerQueueHealthActive ? prisma.emailLog.count({ where: { status: EmailLogStatus.PENDING, processingStartedAt: { lt: staleBefore } } }) : Promise.resolve(0),
    ownerQueueHealthActive ? prisma.emailLog.count({ where: { status: EmailLogStatus.PENDING, attemptCount: 0, processingStartedAt: null } }) : Promise.resolve(0),
    ownerQueueHealthActive ? prisma.emailLog.count({ where: { status: EmailLogStatus.PENDING, processingStartedAt: { not: null } } }) : Promise.resolve(0),
    isOwner && safeView === "attention" ? prisma.bookingSubmissionLog.count({ where: criticalBookingSubmissionWhere({ gte: attentionSince }) }) : Promise.resolve(0),
  ]);
  const [emails, bookingHistory, reschedules, vouchers, redemptions, canonicalRedemptions, voucherChanges, serviceChanges, servicePriceChanges, siteSettingsChanges, availabilityAudits, adminUserAudits, submissions] = await Promise.all([
    emailActive
      ? attentionIncidentActive
        ? Promise.all([
          prisma.emailLog.findMany({
            where: attentionIncidentWhere,
            include: {
              booking: { select: { id: true, clientNameSnapshot: true, serviceNameSnapshot: true } },
              client: { select: { fullName: true } },
              incidentResends: {
                where: attentionRepresentativeFailureWhere,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                include: {
                  booking: { select: { id: true, clientNameSnapshot: true, serviceNameSnapshot: true } },
                  client: { select: { fullName: true } },
                },
              },
            },
          }),
          attentionSupplementActive
            ? prisma.emailLog.findMany({ where: attentionSupplementWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { booking: { select: { id: true, clientNameSnapshot: true, serviceNameSnapshot: true } }, client: { select: { fullName: true } }, resendRoot: { select: { incidentResolvedAt: true, incidentResolvedByEmailLogId: true, incidentResolutionKind: true } } } })
            : Promise.resolve([]),
        ]).then(([incidents, supplementary]) => [
          ...incidents.map((incident) => ({ representativeEmailLog: incident.incidentResends[0] ?? incident, incidentRoot: incident })),
          ...supplementary.map((log) => ({ representativeEmailLog: log, incidentRoot: log.resendRoot ?? log })),
        ])
        : prisma.emailLog.findMany({ where: emailWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { booking: { select: { id: true, clientNameSnapshot: true, serviceNameSnapshot: true } }, client: { select: { fullName: true } }, resendRoot: { select: { incidentResolvedAt: true, incidentResolvedByEmailLogId: true, incidentResolutionKind: true } } } }).then((logs) => logs.map((log) => ({ representativeEmailLog: log, incidentRoot: log.resendRoot ?? log })))
      : Promise.resolve([]),
    bookingActive ? prisma.bookingStatusHistory.findMany({ where: bookingHistoryWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { booking: { select: { id: true, clientNameSnapshot: true, serviceNameSnapshot: true } }, actorUser: { select: { name: true } } } }) : Promise.resolve([]),
    bookingActive ? prisma.bookingRescheduleLog.findMany({ where: rescheduleWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { booking: { select: { id: true, clientNameSnapshot: true, serviceNameSnapshot: true } }, changedByUser: { select: { name: true } } } }) : Promise.resolve([]),
    voucherActive ? prisma.voucher.findMany({ where: voucherWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, code: true, createdAt: true, createdByUser: { select: { name: true } } } }) : Promise.resolve([]),
    voucherActive ? prisma.voucherRedemption.findMany({ where: redemptionWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ redeemedAt: "desc" }, { id: "desc" }], include: { voucher: { select: { id: true, code: true } }, redeemedByUser: { select: { name: true } } } }) : Promise.resolve([]),
    Promise.resolve([]),
    voucherActive ? prisma.voucherChangeLog.findMany({ where: voucherChangeWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { voucher: { select: { id: true, code: true } }, actorUser: { select: { name: true } } } }) : Promise.resolve([]),
    serviceActive ? prisma.serviceChangeLog.findMany({ where: serviceChangeWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { service: { select: { id: true, name: true, publicName: true } }, actorUser: { select: { name: true } } } }) : Promise.resolve([]),
    serviceActive ? prisma.servicePriceChangeLog.findMany({ where: servicePriceChangeWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { service: { select: { id: true, name: true, publicName: true } }, changedByUser: { select: { name: true } } } }) : Promise.resolve([]),
    settingsActive ? prisma.siteSettingsChangeLog.findMany({ where: siteSettingsChangeWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { actorUser: { select: { name: true } } } }) : Promise.resolve([]),
    availabilityActive ? prisma.availabilityAuditEvent.findMany({ where: availabilityWhere, ...(candidateTake ? { take: candidateTake } : {}), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { actorUser: { select: { name: true } } } }) : Promise.resolve([]),
    adminAuditActive ? prisma.adminUserAuditEvent.findMany({ where: adminUserAuditWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { targetUser: { select: { name: true } }, actorUser: { select: { name: true } } } }) : Promise.resolve([]),
    submissionActive ? prisma.bookingSubmissionLog.findMany({ where: submissionWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { booking: { select: { id: true, clientNameSnapshot: true, serviceNameSnapshot: true } }, client: { select: { fullName: true } } } }) : Promise.resolve([]),
  ]);
  const candidateVoucherIdentities = bookingHistory.flatMap((audit) => {
    const voucherCode = getBookingHistoryVoucherCode(audit.metadata);
    return audit.reason === voucherCompletionAuditReason && getBookingHistorySource(audit.metadata) === voucherCompletionAuditSource && voucherCode
      ? [{ bookingId: audit.bookingId, voucher: { is: { code: voucherCode } } }]
      : [];
  });
  const candidateCanonicalRedemptions = candidateVoucherIdentities.length > 0
    ? await prisma.voucherRedemption.findMany({ where: { OR: candidateVoucherIdentities }, select: { bookingId: true, voucher: { select: { code: true } } } })
    : canonicalRedemptions;
  const categoryIds = serviceChanges.flatMap((entry) => [entry.before, entry.after]
    .map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const categoryValue = value.categoryId;
      if (typeof categoryValue === "string") return categoryValue;
      if (categoryValue && typeof categoryValue === "object" && !Array.isArray(categoryValue) && typeof categoryValue.categoryId === "string") return categoryValue.categoryId;
      return null;
    })
    .filter((id): id is string => id !== null));
  const categoryNames = new Map((categoryIds.length > 0
    ? await prisma.serviceCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
    : [])
    .map((category) => [category.id, category.name]));

  const bookingHref = (id: string) => getAdminBookingHref(input.area, id);
  const voucherHref = (id: string) => `${input.area === "owner" ? "/admin" : "/admin/provoz"}/vouchery/${id}`;
  const visibleBookingHistory = filterDuplicateVoucherCompletionAudits(bookingHistory, candidateCanonicalRedemptions);
  const items: AdminLogItem[] = [
    ...emails.map(({ representativeEmailLog: log, incidentRoot }) => {
      const tracking = deriveTrackingState(log);
      const logSeverity = getEmailLogSeverity({ ...log, staleBefore });
      const status = getEmailRecentStatus(log.status, log.processingStartedAt, log.attemptCount);
      const isStuck = log.processingToken !== null
        && isEmailWorkerClaimStale(log.processingStartedAt, now);
      const primaryAction: AdminLogItem["primaryAction"] = isOwner
        ? (isStuck ? "release" : status === "failed" || status === "retry" ? "retry" : "detail")
        : null;
      const incidentResolutionKind = incidentRoot.incidentResolutionKind
        ?? (incidentRoot.incidentResolvedByEmailLogId ? EmailIncidentResolutionKind.DELIVERED_RESEND : null);
      const incidentResolutionLabel = incidentRoot.incidentResolvedAt && tracking.value === "failed"
        ? incidentResolutionKind === EmailIncidentResolutionKind.MANUAL
          ? " • Ručně uzavřeno"
          : " • Vyřešeno následným odesláním"
        : "";
      return { id: `email:${log.id}`, occurredAt: log.createdAt.toISOString(), category: "email" as const, severity: logSeverity, title: log.subject, description: `${log.recipientEmail}${tracking.value !== "pending" ? ` • ${tracking.label}` : ""}${incidentResolutionLabel}${log.errorMessage ? ` • ${getErrorSummary(log.errorMessage)}` : ""}`, actorLabel: null, entityLabel: log.booking ? `${log.booking.clientNameSnapshot} • ${log.booking.serviceNameSnapshot}` : log.client?.fullName ?? null, entityHref: log.booking ? bookingHref(log.booking.id) : null, sourceType: "email" as const, sourceId: log.id, primaryAction, emailLogId: log.id, queueState: getEmailRecentStatusLabel(log.status, log.processingStartedAt, log.attemptCount), trackingState: tracking.label };
    }),
    ...visibleBookingHistory.map((entry) => {
      const presentation = getBookingHistoryPresentation(entry);
      return { id: `booking-history:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "event" as const, severity: presentation.severity, title: presentation.title, description: presentation.description ?? entry.note, actorLabel: entry.actorUser?.name ?? (entry.actorType === "CLIENT" ? "Klientka" : entry.actorType === "SYSTEM" ? "Systém" : null), entityLabel: entry.booking ? `${entry.booking.clientNameSnapshot} • ${entry.booking.serviceNameSnapshot}` : "Odstraněná rezervace", entityHref: entry.booking ? bookingHref(entry.booking.id) : null, sourceType: "booking" as const, sourceId: entry.id, primaryAction: entry.booking ? "open" as const : null };
    }),
    ...reschedules.map((entry) => ({ id: `booking-reschedule:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "event" as const, severity: "info" as const, title: "Rezervace přesunuta", description: entry.reason, actorLabel: entry.changedByUser?.name ?? (entry.changedByClient ? "Klientka" : null), entityLabel: entry.booking ? `${entry.booking.clientNameSnapshot} • ${entry.booking.serviceNameSnapshot}` : "Odstraněná rezervace", entityHref: entry.booking ? bookingHref(entry.booking.id) : null, sourceType: "booking" as const, sourceId: entry.id, primaryAction: entry.booking ? "open" as const : null })),
    ...vouchers.map((voucher) => ({ id: `voucher:${voucher.id}`, occurredAt: voucher.createdAt.toISOString(), category: "event" as const, severity: "info" as const, title: "Voucher vytvořen", description: null, actorLabel: voucher.createdByUser?.name ?? null, entityLabel: `Voucher ${voucher.code}`, entityHref: voucherHref(voucher.id), sourceType: "voucher" as const, sourceId: voucher.id, primaryAction: "open" as const })),
    ...(voucherActive ? redemptions.map((redemption) => ({ id: `voucher-redemption:${redemption.id}`, occurredAt: redemption.redeemedAt.toISOString(), category: "event" as const, severity: "success" as const, title: "Voucher uplatněn", description: null, actorLabel: redemption.redeemedByUser?.name ?? null, entityLabel: redemption.voucher ? `Voucher ${redemption.voucher.code}` : "Odstraněný voucher", entityHref: redemption.voucher ? voucherHref(redemption.voucher.id) : null, sourceType: "voucher" as const, sourceId: redemption.id, primaryAction: redemption.voucher ? "open" as const : null })) : []),
    ...voucherChanges.map((entry) => ({ id: `voucher-change:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "event" as const, severity: "info" as const, title: entry.operation === "CANCEL" ? "Voucher zrušen" : "Voucher upraven", description: auditChangeDescription(entry.before, entry.after), actorLabel: entry.actorUser.name, entityLabel: `Voucher ${entry.voucher.code}`, entityHref: voucherHref(entry.voucher.id), sourceType: "voucher" as const, sourceId: entry.id, primaryAction: "open" as const })),
    ...serviceChanges.map((entry) => ({ id: `service-change:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "event" as const, severity: "info" as const, title: "Služba upravena", description: auditChangeDescription(entry.before, entry.after, categoryNames), actorLabel: entry.actorUser.name, entityLabel: entry.service.publicName ?? entry.service.name, entityHref: `${input.area === "owner" ? "/admin" : "/admin/provoz"}/sluzby?serviceId=${entry.service.id}`, sourceType: "service" as const, sourceId: entry.id, primaryAction: "open" as const })),
    ...servicePriceChanges.map((entry) => ({ id: `service-price-change:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "event" as const, severity: "info" as const, title: "Cena služby změněna", description: `${formatServicePrice(entry.oldPriceFromCzk)} → ${formatServicePrice(entry.newPriceFromCzk)}`, actorLabel: entry.changedByUser?.name ?? null, entityLabel: entry.service.publicName ?? entry.service.name, entityHref: `${input.area === "owner" ? "/admin" : "/admin/provoz"}/sluzby?serviceId=${entry.service.id}`, sourceType: "service" as const, sourceId: entry.id, primaryAction: "open" as const })),
    ...siteSettingsChanges.map((entry) => ({ id: `settings-change:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "event" as const, severity: "info" as const, title: entry.operation === "UPDATE_BOOKING_POLICY" ? "Pravidla rezervace upravena" : entry.operation === "UPDATE_SALON" ? "Údaje salonu upraveny" : "E-mailová nastavení upravena", description: auditChangeDescription(entry.before, entry.after), actorLabel: entry.actorUser.name, entityLabel: "Nastavení webu", entityHref: "/admin/nastaveni", sourceType: "settings" as const, sourceId: entry.id, primaryAction: "open" as const })),
    ...availabilityAudits.map((entry) => ({ id: `availability:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "event" as const, severity: "info" as const, title: availabilityAuditLabel(entry.operation), description: availabilityAuditDescription(entry), actorLabel: entry.actorUser?.name ?? null, entityLabel: `Volné termíny • ${entry.dateKey}`, entityHref: `${input.area === "owner" ? "/admin" : "/admin/provoz"}/volne-terminy?week=${entry.dateKey}&day=${entry.dateKey}`, sourceType: "availability" as const, sourceId: entry.id, primaryAction: "open" as const })),
    ...adminUserAudits.map((entry) => ({ id: `admin-user-audit:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "system" as const, severity: "info" as const, title: ({ CREATE: "Admin účet vytvořen", UPDATE_PROFILE: "Admin účet upraven", CHANGE_ROLE: "Role admina změněna", ACTIVATE: "Admin účet aktivován", DEACTIVATE: "Admin účet deaktivován", INVITE_RESEND: "Pozvánka znovu vydána" } as Record<string, string>)[entry.operation] ?? "Admin účet upraven", description: auditChangeDescription(entry.before, entry.after), actorLabel: entry.actorUser.name, entityLabel: entry.targetUser.name, entityHref: "/admin/uzivatele", sourceType: "admin" as const, sourceId: entry.id, primaryAction: "open" as const })),
    ...submissions.map((entry) => {
      const presentation = getBookingSubmissionPresentation(entry);
      return { id: `submission:${entry.id}`, occurredAt: entry.createdAt.toISOString(), category: "system" as const, severity: presentation.severity, title: presentation.title, description: entry.failureReason ?? entry.failureCode, actorLabel: "Systém", entityLabel: entry.booking ? `${entry.booking.clientNameSnapshot} • ${entry.booking.serviceNameSnapshot}` : entry.client?.fullName ?? presentation.entityFallback, entityHref: entry.booking ? bookingHref(entry.booking.id) : null, sourceType: "submission" as const, sourceId: entry.id, primaryAction: entry.booking ? "open" as const : null };
    }),
  ];
  const visible = items.filter((item) => {
    if (safeView === "attention" && item.severity !== "error" && !(item.sourceType === "email" && item.severity === "warning")) return false;
    if (safeView === "events" && item.category !== "event") return false;
    if (safeView === "emails" && item.category !== "email") return false;
    if (severity !== "all" && item.severity !== severity) return false;
    if (source !== "all" && item.sourceType !== source) return false;
    return true;
  });
  const deduplicatedTotal = exactEventTotal ?? visible.length;
  const deduplicatedMeta = eventMeta ?? getAdminLogPageMeta(deduplicatedTotal, requestedPage);
  return { area: input.area, view: safeView, items: sortAndPageAdminLogItems(visible, deduplicatedMeta.page), total: deduplicatedTotal, page: deduplicatedMeta.page, pageCount: deduplicatedMeta.pageCount, pageSize: adminLogPageSize, filters: { query, severity, source, emailType, dateFrom: input.dateFrom ?? "", dateTo: input.dateTo ?? "" }, attention: { failed, retry, stuck, critical }, queueStats: [{ label: "Čeká", value: String(pending), tone: pending ? "accent" : "muted" }, { label: "Retry", value: String(retry), tone: retry ? "accent" : "muted" }, { label: "Zpracovává se", value: String(processing), tone: processing ? "accent" : "muted" }, { label: "Aktivní incidenty", value: String(failed), tone: failed ? "accent" : "muted" }], workerSummary: getWorkerSummary({ pending, retrying: retry, processing, failed }) };
}

export async function getEmailLogDetailData(emailLogId: string): Promise<EmailLogDetailData | null> {
  const now = new Date();
  const emailLog = await prisma.emailLog.findUnique({
    where: { id: emailLogId },
    include: {
      booking: {
        select: {
          id: true,
          clientNameSnapshot: true,
          clientEmailSnapshot: true,
          serviceNameSnapshot: true,
          scheduledStartsAt: true,
          scheduledEndsAt: true,
          status: true,
        },
      },
      client: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          isActive: true,
        },
      },
      actionToken: {
        select: {
          id: true,
          type: true,
          expiresAt: true,
          usedAt: true,
          revokedAt: true,
        },
      },
      incidentManualResolvedByUser: {
        select: { name: true, email: true },
      },
      resendRoot: {
        select: {
          incidentResolvedAt: true,
          incidentResolvedByEmailLogId: true,
          incidentResolutionKind: true,
          incidentManualResolutionReason: true,
          incidentManualResolutionNote: true,
          incidentManualResolvedByUser: {
            select: { name: true, email: true },
          },
        },
      },
      incidentResends: {
        where: getEmailDeliveryFailureWhere(),
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!emailLog) {
    return null;
  }

  const processingStartedAt = emailLog.processingStartedAt;
  const isProcessing = processingStartedAt !== null;
  const isStuck = isEmailWorkerClaimStale(processingStartedAt, now);
  const finalStatus = getEmailDetailFinalStatus(emailLog);
  const tracking = deriveTrackingState(emailLog);
  const bookingTitle = emailLog.booking?.serviceNameSnapshot ?? "Bez navázané rezervace";
  const bookingScheduleLabel = emailLog.booking
    ? formatTimeRange(emailLog.booking.scheduledStartsAt, emailLog.booking.scheduledEndsAt)
    : "Bez termínu rezervace";
  const clientName = emailLog.booking?.clientNameSnapshot ?? emailLog.client?.fullName ?? "Bez klientky";
  const lastAttemptLabel = formatDateTimeLabel(emailLog.sentAt ?? emailLog.updatedAt);
  const incidentRoot = emailLog.resendRoot ?? emailLog;
  const incidentIsActive = incidentRoot.incidentResolvedAt === null
    && (isEmailDeliveryFailure(emailLog)
      || (emailLog.resendRootId === null && emailLog.incidentResends.length > 0));
  const incidentResolutionKind = incidentRoot.incidentResolutionKind
    ?? (incidentRoot.incidentResolvedByEmailLogId ? EmailIncidentResolutionKind.DELIVERED_RESEND : null);
  const incidentResolution = incidentRoot.incidentResolvedAt && incidentResolutionKind
    ? incidentResolutionKind === EmailIncidentResolutionKind.MANUAL
      ? {
          label: "Ručně uzavřeno",
          detail: `${formatDateTimeLabel(incidentRoot.incidentResolvedAt)} • ${incidentRoot.incidentManualResolvedByUser?.name ?? incidentRoot.incidentManualResolvedByUser?.email ?? "Neznámý OWNER"} • ${manualIncidentResolutionReasonLabel(incidentRoot.incidentManualResolutionReason)}${incidentRoot.incidentManualResolutionNote ? ` • ${incidentRoot.incidentManualResolutionNote}` : ""}`,
        }
      : {
          label: "Vyřešeno následným odesláním",
          detail: `${formatDateTimeLabel(incidentRoot.incidentResolvedAt)} • doručený explicitní resend`,
        }
    : null;

  return {
    id: emailLog.id,
    status: emailLog.status,
    statusLabel: statusLabel(emailLog.status),
    finalStatus: finalStatus.value,
    finalStatusLabel: finalStatus.label,
    finalStatusDetail: finalStatus.detail,
    statusNeedsAttention: finalStatus.needsAttention,
    type: emailLog.type,
    typeLabel: emailTypeLabel(emailLog.type, emailLog.templateKey),
    recipientEmail: emailLog.recipientEmail,
    subject: emailLog.subject,
    businessTitle: emailLog.subject,
    templateKey: emailLog.templateKey,
    attemptCount: emailLog.attemptCount,
    queueStateLabel: retryStateLabel(
      emailLog.nextAttemptAt,
      emailLog.processingStartedAt,
      emailLog.attemptCount,
    ),
    isProcessing,
    isStuck,
    canRetry: emailLog.status === EmailLogStatus.PENDING && !isProcessing,
    canRelease: emailLog.status === EmailLogStatus.PENDING
      && isStuck
      && emailLog.processingToken !== null,
    nextAttemptLabel: formatDateTimeLabel(emailLog.nextAttemptAt),
    processingStartedLabel: formatDateTimeLabel(emailLog.processingStartedAt),
    sentAtLabel: formatDateTimeLabel(emailLog.sentAt),
    createdAtLabel: formatDateTimeLabel(emailLog.createdAt),
    updatedAtLabel: formatDateTimeLabel(emailLog.updatedAt),
    providerLabel: emailLog.provider ?? "Bez providera",
    providerMessageIdLabel: emailLog.providerMessageId ?? "Bez message id",
    transportStatusLabel: emailLog.status === EmailLogStatus.SENT ? "Úspěšné" : statusLabel(emailLog.status),
    deliveryStatusLabel: tracking.value === "pending" && emailLog.status === EmailLogStatus.SENT
      ? "Bez potvrzení od providera"
      : tracking.value === "failed" ? finalStatus.detail : tracking.label,
    errorMessage: emailLog.errorMessage,
    errorSummary: getErrorSummary(emailLog.errorMessage),
    payload: emailLog.payload,
    bookingSummary: emailLog.booking
      ? `${emailLog.booking.clientNameSnapshot} • ${emailLog.booking.serviceNameSnapshot} • ${bookingScheduleLabel}`
      : "Bez navázané rezervace",
    bookingHref: emailLog.booking ? getAdminBookingHref("owner", emailLog.booking.id) : null,
    bookingTitle,
    bookingScheduleLabel,
    clientName,
    clientSummary: emailLog.client
      ? `${emailLog.client.fullName} • ${emailLog.client.email ?? "Bez e-mailu"}${emailLog.client.phone ? ` • ${formatClientPhoneForDisplay(emailLog.client.phone)}` : ""}`
      : "Bez navázaného klienta",
    clientContactEmail: emailLog.client?.email ?? null,
    canResend: !isProcessing,
    canCloseIncident: incidentIsActive,
    incidentResolution,
    actionTokenId: emailLog.actionToken?.id ?? null,
    actionTokenLabel: emailLog.actionToken ? actionTokenTypeLabel(emailLog.actionToken.type) : "Bez navázaného action tokenu",
    actionTokenSummary: emailLog.actionToken
      ? `${actionTokenTypeLabel(emailLog.actionToken.type)} • expirace ${formatDateTimeLabel(emailLog.actionToken.expiresAt)}${emailLog.actionToken.usedAt ? ` • použito ${formatDateTimeLabel(emailLog.actionToken.usedAt)}` : ""}${emailLog.actionToken.revokedAt ? ` • zrušeno ${formatDateTimeLabel(emailLog.actionToken.revokedAt)}` : ""}`
      : "Bez navázaného action tokenu",
    lastAttemptLabel,
    headerTimestampLabel: emailLog.sentAt ? formatDateTimeLabel(emailLog.sentAt) : lastAttemptLabel,
    headerTimestampTitle: emailLog.sentAt ? "Odesláno" : "Poslední pokus",
  };
}
