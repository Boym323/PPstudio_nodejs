import {
  AvailabilitySlotServiceRestrictionMode,
  AvailabilitySlotStatus,
  BookingActionTokenType,
  BookingStatus,
  EmailAudience,
  EmailLogStatus,
  EmailLogType,
  Prisma,
} from "@/generated/prisma/client";

import { env } from "@/config/env";
import {
  buildBookingActionToken,
  buildBookingCancellationUrl,
  buildBookingManagementUrl,
  buildBookingSelfServiceActionExpiry,
  lockBookingActionToken,
  synchronizeActiveBookingClientActionTokenExpiry,
} from "@/features/booking/lib/booking-action-tokens";
import { formatBookingDateLabel } from "@/features/booking/lib/booking-format";
import {
  isInternallyBlockingSlotStatus,
  resolvePublishedSlotCoverage,
} from "@/features/booking/lib/booking-slot-availability";
import {
  enqueueBookingReminder24hForBooking,
  getBookingReminder24hEnqueueWindowPosition,
} from "@/features/booking/lib/booking-reminders";
import { sendOwnerBookingPushover, sendOwnerSystemErrorPushover } from "@/lib/notifications/pushover";
import { prisma } from "@/lib/prisma";
import { scrubSensitiveEmailPayload } from "@/lib/email/payload-security";
import {
  ActiveClientDeliveryLeaseError,
  advanceBookingCommunicationGeneration,
  assertNoActiveClientDeliveryLease,
} from "@/lib/email/booking-delivery-fence";
import { getBookingPolicySettings, getEmailBrandingSettings, isBookingWithinWindow } from "@/lib/site-settings";
import { resolveBookingTimingSnapshot } from "./booking-cleanup";
import { canPreserveAutoLunchForBooking } from "./booking-auto-lunch-enforcement";
import {
  archiveOrphanedManualOverrideSlotAfterCancellation,
  compactAdjacentEditableSlotsForBooking,
  preparePublishedAvailabilityForManualOverride,
  restoreArchivedSlotAroundManualOverride,
} from "./booking-slot-compaction";

const ACTIVE_BOOKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED] as const;
const MAX_BOOKING_TRANSACTION_RETRIES = 3;
const EDITABLE_SLOT_CAPACITY = 1;

export const bookingRescheduleErrorCodes = {
  notFound: "NOT_FOUND",
  clientActionTokenInvalid: "CLIENT_ACTION_TOKEN_INVALID",
  statusNotAllowed: "STATUS_NOT_ALLOWED",
  invalidDateTime: "INVALID_DATE_TIME",
  sameTerm: "SAME_TERM",
  slotUnavailable: "SLOT_UNAVAILABLE",
  slotTooShort: "SLOT_TOO_SHORT",
  slotNotAllowed: "SLOT_NOT_ALLOWED",
  conflict: "CONFLICT",
  concurrentModification: "CONCURRENT_MODIFICATION",
  temporaryFailure: "TEMPORARY_FAILURE",
} as const;

export type BookingRescheduleErrorCode =
  (typeof bookingRescheduleErrorCodes)[keyof typeof bookingRescheduleErrorCodes];

export class BookingRescheduleError extends Error {
  code: BookingRescheduleErrorCode;
  suggestedField: "newDate" | "newTime" | "slot" | "form";

  constructor(
    code: BookingRescheduleErrorCode,
    message: string,
    suggestedField: "newDate" | "newTime" | "slot" | "form" = "form",
  ) {
    super(message);
    this.name = "BookingRescheduleError";
    this.code = code;
    this.suggestedField = suggestedField;
  }
}

export type RescheduleBookingInput = {
  bookingId: string;
  clientActionTokenHash?: string;
  newStartAt: string;
  newEndAt?: string;
  slotId?: string;
  reason?: string | null;
  changedByUserId: string | null;
  changedByClient?: boolean;
  allowManualOverride?: boolean;
  notifyClient: boolean;
  includeCalendarAttachment?: boolean;
  expectedUpdatedAt?: string;
};

export type RescheduleBookingResult = {
  bookingId: string;
  scheduledStartsAt: string;
  scheduledEndsAt: string;
  previousScheduledStartsAt: string;
  previousScheduledEndsAt: string;
  scheduledAtLabel: string;
  previousScheduledAtLabel: string;
  rescheduleCount: number;
  manualOverride: boolean;
  notificationStatus: "queued" | "logged" | "skipped";
};

type BookingSlotRecord = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: AvailabilitySlotStatus;
  serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode;
  publicNote: string | null;
  internalNote: string | null;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  createdByUserId: string | null;
  allowedServices: Array<{
    serviceId: string;
  }>;
};

type RescheduleTransactionResult = {
  bookingId: string;
  serviceId: string;
  communicationGeneration: number;
  serviceName: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  previousStartsAt: Date;
  previousEndsAt: Date;
  manualOverride: boolean;
  rescheduleCount: number;
  notificationStatus: "queued" | "logged" | "skipped";
};

type BookingRescheduledNotificationInput = {
  bookingId: string;
  clientId: string;
  serviceId: string;
  communicationGeneration?: number;
  clientEmail: string;
  clientName: string;
  serviceName: string;
  previousStartsAt: Date;
  previousEndsAt: Date;
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  includeCalendarAttachment: boolean;
  notifyAdminOnClientReschedule: boolean;
};

type BookingReschedulingDependencies = {
  prisma: typeof prisma;
  getBookingPolicySettings: typeof getBookingPolicySettings;
  isBookingWithinWindow: typeof isBookingWithinWindow;
  queueBookingRescheduledNotification: typeof queueBookingRescheduledNotification;
  createBookingRescheduledClientEmailLog?: typeof createBookingRescheduledClientEmailLog;
  sendOwnerBookingPushover: typeof sendOwnerBookingPushover;
  sendOwnerSystemErrorPushover: typeof sendOwnerSystemErrorPushover;
};

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isRetryablePrismaError(error: unknown) {
  const driverAdapterCause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause?: unknown }).cause
      : null;
  const rawQueryDriverCause =
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2010"
    && typeof error.meta === "object"
    && error.meta !== null
    && "driverAdapterError" in error.meta
    && typeof error.meta.driverAdapterError === "object"
    && error.meta.driverAdapterError !== null
    && "cause" in error.meta.driverAdapterError
    && typeof error.meta.driverAdapterError.cause === "object"
    && error.meta.driverAdapterError.cause !== null
      ? error.meta.driverAdapterError.cause
      : null;

  return (
    (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2034"
        || (
          error.code === "P2010"
          && rawQueryDriverCause !== null
          && "originalCode" in rawQueryDriverCause
          && rawQueryDriverCause.originalCode === "40001"
        ))
    ) ||
    (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "DriverAdapterError" &&
      typeof driverAdapterCause === "object" &&
      driverAdapterCause !== null &&
      "kind" in driverAdapterCause &&
      driverAdapterCause.kind === "TransactionWriteConflict"
    )
  );
}

async function lockRequestedSlot(
  tx: Prisma.TransactionClient,
  slotId: string,
): Promise<BookingSlotRecord | null> {
  const lockedSlotRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AvailabilitySlot"
    WHERE "id" = ${slotId}
    FOR UPDATE
  `);

  if (lockedSlotRows.length === 0) {
    return null;
  }

  return tx.availabilitySlot.findUnique({
    where: {
      id: slotId,
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      status: true,
      serviceRestrictionMode: true,
      publicNote: true,
      internalNote: true,
      publishedAt: true,
      cancelledAt: true,
      createdByUserId: true,
      allowedServices: {
        select: {
          serviceId: true,
        },
      },
    },
  });
}

async function lockAvailabilityCoverage(
  tx: Prisma.TransactionClient,
  slotId: string | undefined,
  requestedStartsAt: Date,
  requestedBlockedUntil: Date,
) {
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "AvailabilitySlot"
    WHERE (
      ${slotId ?? null}::text IS NOT NULL
      AND "id" = ${slotId ?? null}
    )
    OR (
      "startsAt" < ${requestedBlockedUntil}
      AND "endsAt" > ${requestedStartsAt}
    )
    FOR UPDATE
  `);
}

async function validateClientActionTokenInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    tokenHash: string;
    bookingId: string;
  },
) {
  const lockedTokenRows = await lockBookingActionToken(tx, input.tokenHash);

  const token = lockedTokenRows.length > 0
    ? await tx.bookingActionToken.findUnique({
        where: {
          tokenHash: input.tokenHash,
        },
        select: {
          bookingId: true,
          type: true,
          expiresAt: true,
          usedAt: true,
          revokedAt: true,
        },
      })
    : null;

  if (
    !token
    || token.bookingId !== input.bookingId
    || token.type !== BookingActionTokenType.RESCHEDULE
    || token.usedAt !== null
    || token.revokedAt !== null
    || token.expiresAt <= new Date()
  ) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.clientActionTokenInvalid,
      "Odkaz pro správu rezervace už není aktivní. Obnovte prosím stránku a zkuste to znovu.",
    );
  }
}

async function splitSlotForEditing(
  tx: Prisma.TransactionClient,
  slot: BookingSlotRecord,
  requestedStartsAt: Date,
  requestedEndsAt: Date,
) {
  const shouldSplitSlotForAdminEditing =
    slot.capacity === EDITABLE_SLOT_CAPACITY
    && (requestedStartsAt.getTime() > slot.startsAt.getTime()
      || requestedEndsAt.getTime() < slot.endsAt.getTime());

  if (!shouldSplitSlotForAdminEditing) {
    return;
  }

  const beforeInterval =
    requestedStartsAt.getTime() > slot.startsAt.getTime()
      ? { startsAt: slot.startsAt, endsAt: requestedStartsAt }
      : null;
  const afterInterval =
    requestedEndsAt.getTime() < slot.endsAt.getTime()
      ? { startsAt: requestedEndsAt, endsAt: slot.endsAt }
      : null;

  await tx.availabilitySlot.update({
    where: {
      id: slot.id,
    },
    data: {
      startsAt: requestedStartsAt,
      endsAt: requestedEndsAt,
    },
  });

  const intervalFragments = [beforeInterval, afterInterval].filter(
    (fragment): fragment is { startsAt: Date; endsAt: Date } => fragment !== null,
  );

  for (const fragment of intervalFragments) {
    await tx.availabilitySlot.create({
      data: {
        startsAt: fragment.startsAt,
        endsAt: fragment.endsAt,
        capacity: slot.capacity,
        status: slot.status,
        serviceRestrictionMode: slot.serviceRestrictionMode,
        publicNote: slot.publicNote,
        internalNote: slot.internalNote,
        publishedAt: slot.publishedAt,
        cancelledAt: slot.cancelledAt,
        createdByUserId: slot.createdByUserId,
        allowedServices: slot.allowedServices.length > 0
          ? {
              createMany: {
                data: slot.allowedServices.map((allowedService) => ({
                  serviceId: allowedService.serviceId,
                })),
              },
            }
          : undefined,
      },
    });
  }
}

async function splitCoverageSlotsForEditing(
  tx: Prisma.TransactionClient,
  coverageSlots: BookingSlotRecord[],
  requestedStartsAt: Date,
  requestedEndsAt: Date,
) {
  if (coverageSlots.length === 0) {
    return;
  }

  if (coverageSlots.length === 1) {
    await splitSlotForEditing(tx, coverageSlots[0], requestedStartsAt, requestedEndsAt);
    return;
  }

  const firstSlot = coverageSlots[0];
  const lastSlot = coverageSlots[coverageSlots.length - 1];

  if (firstSlot && requestedStartsAt.getTime() > firstSlot.startsAt.getTime()) {
    await splitSlotForEditing(tx, firstSlot, requestedStartsAt, firstSlot.endsAt);
  }

  if (lastSlot && requestedEndsAt.getTime() < lastSlot.endsAt.getTime()) {
    await splitSlotForEditing(tx, lastSlot, lastSlot.startsAt, requestedEndsAt);
  }
}

async function maybeDeleteOrphanedManualOverrideSlot(
  tx: Prisma.TransactionClient,
  slotId: string,
  bookingId: string,
) {
  const slot = await tx.availabilitySlot.findUnique({
    where: {
      id: slotId,
    },
    select: {
      id: true,
      status: true,
      bookings: {
        where: {
          id: {
            not: bookingId,
          },
          status: {
            in: [...ACTIVE_BOOKING_STATUSES],
          },
        },
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!slot || slot.status !== AvailabilitySlotStatus.DRAFT || slot.bookings.length > 0) {
    return;
  }

  await archiveOrphanedManualOverrideSlotAfterCancellation(tx, slotId);
}

function getUniqueConstraintTargets(error: Prisma.PrismaClientKnownRequestError) {
  const target = error.meta?.target;

  if (Array.isArray(target)) {
    return target.map((item) => String(item));
  }

  if (typeof target === "string") {
    return [target];
  }

  return [];
}

function mapKnownPrismaError(error: Prisma.PrismaClientKnownRequestError) {
  if (error.code !== "P2002") {
    return null;
  }

  const targets = getUniqueConstraintTargets(error);

  if (
    targets.includes("Booking_exact_duplicate_active_key")
    || (
      targets.includes("slotId")
      && targets.includes("clientId")
      && targets.includes("scheduledStartsAt")
      && targets.includes("scheduledEndsAt")
    )
  ) {
    return new BookingRescheduleError(
      bookingRescheduleErrorCodes.conflict,
      "Nový termín už koliduje s jinou aktivní rezervací.",
      "slot",
    );
  }

  return new BookingRescheduleError(
    bookingRescheduleErrorCodes.concurrentModification,
    "Rezervace se mezitím změnila v jiném okně. Obnovte detail a zkuste to znovu.",
  );
}

async function createBookingRescheduledClientEmailLog(
  tx: Prisma.TransactionClient,
  input: BookingRescheduledNotificationInput,
) {
  const now = new Date();
  const manageToken = buildBookingActionToken();
  const cancellationToken = buildBookingActionToken();
  const actionToken = await tx.bookingActionToken.create({
    data: {
      bookingId: input.bookingId,
      type: BookingActionTokenType.RESCHEDULE,
      tokenHash: manageToken.tokenHash,
      expiresAt: buildBookingSelfServiceActionExpiry(input.scheduledStartsAt),
      lastSentAt: now,
    },
    select: {
      id: true,
    },
  });

  await tx.bookingActionToken.create({
    data: {
      bookingId: input.bookingId,
      type: BookingActionTokenType.CANCEL,
      tokenHash: cancellationToken.tokenHash,
      expiresAt: buildBookingSelfServiceActionExpiry(input.scheduledStartsAt),
      lastSentAt: now,
    },
  });

  const clientPayload = {
    bookingId: input.bookingId,
    serviceId: input.serviceId,
    serviceName: input.serviceName,
    clientName: input.clientName,
    previousStartsAt: input.previousStartsAt.toISOString(),
    previousEndsAt: input.previousEndsAt.toISOString(),
    scheduledStartsAt: input.scheduledStartsAt.toISOString(),
    scheduledEndsAt: input.scheduledEndsAt.toISOString(),
    manageReservationUrl: buildBookingManagementUrl(manageToken.rawToken),
    cancellationUrl: buildBookingCancellationUrl(cancellationToken.rawToken),
    includeCalendarAttachment: input.includeCalendarAttachment,
  };

  await tx.emailLog.create({
    data: {
      bookingId: input.bookingId,
      clientId: input.clientId,
      actionTokenId: actionToken.id,
      type: EmailLogType.BOOKING_RESCHEDULED,
      audience: EmailAudience.CLIENT,
      status: env.EMAIL_DELIVERY_MODE === "background" ? undefined : EmailLogStatus.SENT,
      attemptCount: env.EMAIL_DELIVERY_MODE === "background" ? undefined : 1,
      nextAttemptAt: env.EMAIL_DELIVERY_MODE === "background" ? now : undefined,
      processingStartedAt: null,
      processingToken: null,
      communicationGeneration: input.communicationGeneration,
      recipientEmail: input.clientEmail,
      subject: `Změna termínu rezervace: ${input.serviceName}`,
      templateKey: "booking-rescheduled-v1",
      payload: env.EMAIL_DELIVERY_MODE === "background"
        ? clientPayload
        : scrubSensitiveEmailPayload(clientPayload),
      provider: env.EMAIL_DELIVERY_MODE === "background" ? undefined : "log",
      sentAt: env.EMAIL_DELIVERY_MODE === "background" ? undefined : now,
    },
  });

  return env.EMAIL_DELIVERY_MODE === "background" ? "queued" as const : "logged" as const;
}

// Admin-only post-commit notification; the client outbox is created in the transaction above.
async function queueBookingRescheduledNotification(
  input: BookingRescheduledNotificationInput,
) {
  const now = new Date();

  if (input.notifyAdminOnClientReschedule) {
    const emailBranding = await getEmailBrandingSettings();
    const adminNotificationEmail = emailBranding.notificationAdminEmail.trim();

    if (adminNotificationEmail.length > 0) {
      await prisma.emailLog.create({
        data: {
          bookingId: input.bookingId,
          clientId: input.clientId,
          type: EmailLogType.BOOKING_RESCHEDULED,
          audience: EmailAudience.ADMIN,
          status: env.EMAIL_DELIVERY_MODE === "background" ? undefined : EmailLogStatus.SENT,
          attemptCount: env.EMAIL_DELIVERY_MODE === "background" ? undefined : 1,
          nextAttemptAt: env.EMAIL_DELIVERY_MODE === "background" ? now : undefined,
          processingStartedAt: null,
          processingToken: null,
          recipientEmail: adminNotificationEmail,
          subject: `Přesunutá rezervace: ${input.serviceName}`,
          templateKey: "admin-booking-rescheduled-v1",
          payload: {
            bookingId: input.bookingId,
            serviceName: input.serviceName,
            clientName: input.clientName,
            clientEmail: input.clientEmail,
            previousStartsAt: input.previousStartsAt.toISOString(),
            previousEndsAt: input.previousEndsAt.toISOString(),
            scheduledStartsAt: input.scheduledStartsAt.toISOString(),
            scheduledEndsAt: input.scheduledEndsAt.toISOString(),
            adminUrl: `${env.NEXT_PUBLIC_APP_URL}/admin/rezervace/${input.bookingId}`,
          },
          provider: env.EMAIL_DELIVERY_MODE === "background" ? undefined : "log",
          sentAt: env.EMAIL_DELIVERY_MODE === "background" ? undefined : now,
        },
      });
    }
  }
}

async function rescheduleBookingInTransaction(
  dependencies: BookingReschedulingDependencies,
  tx: Prisma.TransactionClient,
  input: RescheduleBookingInput,
  requestedStartsAt: Date,
) {
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Booking"
    WHERE "id" = ${input.bookingId}
    FOR UPDATE
  `);

  const booking = await tx.booking.findUnique({
    where: {
      id: input.bookingId,
    },
    select: {
      id: true,
      status: true,
      slotId: true,
      serviceId: true,
      serviceDurationMinutes: true,
      cleanupMinutes: true,
      cleanupBlockMinutes: true,
      serviceNameSnapshot: true,
      scheduledStartsAt: true,
      scheduledEndsAt: true,
      blockedUntil: true,
      clientId: true,
      clientNameSnapshot: true,
      clientEmailSnapshot: true,
      communicationGeneration: true,
      clientDeliveryLeaseToken: true,
      clientDeliveryLeaseExpiresAt: true,
      clientPhoneSnapshot: true,
      clientNote: true,
      manualOverride: true,
      voucherRedemptions: {
        select: { id: true },
        take: 1,
      },
      updatedAt: true,
      rescheduleCount: true,
      slot: {
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
          status: true,
          serviceRestrictionMode: true,
          publicNote: true,
          internalNote: true,
          publishedAt: true,
          cancelledAt: true,
          createdByUserId: true,
          allowedServices: {
            select: {
              serviceId: true,
            },
          },
        },
      },
    },
  });

  if (!booking) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.notFound,
      "Rezervaci se nepodařilo najít.",
    );
  }

  try {
    assertNoActiveClientDeliveryLease(booking, new Date());
  } catch (error) {
    if (error instanceof ActiveClientDeliveryLeaseError) {
      throw new BookingRescheduleError(
        bookingRescheduleErrorCodes.concurrentModification,
        "Rezervace se právě zpracovává pro odeslání klientského e-mailu. Obnovte detail a zkuste to znovu.",
      );
    }

    throw error;
  }

  if (input.clientActionTokenHash) {
    await validateClientActionTokenInTransaction(tx, {
      tokenHash: input.clientActionTokenHash,
      bookingId: booking.id,
    });
  }

  if (input.expectedUpdatedAt) {
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);

    if (
      Number.isNaN(expectedUpdatedAt.getTime())
      || booking.updatedAt.getTime() !== expectedUpdatedAt.getTime()
    ) {
      throw new BookingRescheduleError(
        bookingRescheduleErrorCodes.concurrentModification,
        "Rezervace se mezitím změnila v jiném okně. Obnovte detail a zkuste to znovu.",
      );
    }
  }

  if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.statusNotAllowed,
      "Tuto rezervaci už není možné přesunout. Přesun podporujeme jen u čekajících a potvrzených rezervací.",
    );
  }

  if (booking.voucherRedemptions.length > 0) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.statusNotAllowed,
      "Tuto rezervaci už není možné přesunout, protože už obsahuje voucherové čerpání. Finanční událost nebyla automaticky odstraněna.",
    );
  }

  const requestedTiming = resolveBookingTimingSnapshot({
    startsAt: requestedStartsAt,
    serviceDurationMinutes: booking.serviceDurationMinutes,
    cleanupMinutes: booking.cleanupMinutes ?? 0,
    cleanupBlockMinutes: booking.cleanupBlockMinutes ?? 0,
  });
  const requestedEndsAt = input.newEndAt
    ? new Date(input.newEndAt)
    : requestedTiming.serviceEnd;

  if (
    Number.isNaN(requestedEndsAt.getTime())
    || requestedEndsAt <= requestedStartsAt
  ) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.invalidDateTime,
      "Vyplňte platný nový datum a čas rezervace.",
      "newTime",
    );
  }

  if (requestedEndsAt.getTime() - requestedStartsAt.getTime() !== booking.serviceDurationMinutes * 60 * 1000) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.invalidDateTime,
      "Nový termín musí respektovat délku vybrané služby.",
      "newTime",
    );
  }
  const requestedBlockedUntil = new Date(
    requestedEndsAt.getTime() + requestedTiming.cleanupBlockMinutes * 60 * 1000,
  );

  if (
    booking.scheduledStartsAt.getTime() === requestedStartsAt.getTime()
    && booking.scheduledEndsAt.getTime() === requestedEndsAt.getTime()
  ) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.sameTerm,
      "Nový termín je stejný jako ten současný.",
      "newTime",
    );
  }

  const bookingPolicy = await dependencies.getBookingPolicySettings();
  const now = new Date();
  const reminderWindowPosition = getBookingReminder24hEnqueueWindowPosition(
    requestedStartsAt,
    now,
  );
  const isWithinPublicWindow = dependencies.isBookingWithinWindow(
    requestedStartsAt,
    now,
    bookingPolicy.minAdvanceHours,
    bookingPolicy.maxAdvanceDays,
  );

  const requestedSlot = input.slotId && input.slotId !== booking.slotId
    ? await lockRequestedSlot(tx, input.slotId)
    : null;

  // A submitted slotId can be stale after the planner regenerated the day.
  // The authoritative decision below is made from the current locked rows.
  await lockAvailabilityCoverage(
    tx,
    input.slotId,
    requestedStartsAt,
    requestedBlockedUntil,
  );

  const excludedSlotIds = [booking.slotId, requestedSlot?.id].filter((value): value is string => Boolean(value));
  const overlappingSlots = await tx.availabilitySlot.findMany({
    where: {
      id: excludedSlotIds.length > 0 ? { notIn: excludedSlotIds } : undefined,
      startsAt: {
        lt: requestedBlockedUntil,
      },
      endsAt: {
        gt: requestedStartsAt,
      },
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      status: true,
      serviceRestrictionMode: true,
      publicNote: true,
      internalNote: true,
      publishedAt: true,
      cancelledAt: true,
      createdByUserId: true,
      allowedServices: {
        select: {
          serviceId: true,
        },
      },
    },
    orderBy: [{ startsAt: "asc" }],
  });

  const blockingSlots = overlappingSlots.filter((slot) =>
    isInternallyBlockingSlotStatus(slot.status),
  );

  if (blockingSlots.length > 0) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.conflict,
      "Nový termín zasahuje do interně blokovaného času.",
      "slot",
    );
  }

  const publishedCoverage = resolvePublishedSlotCoverage(
    [requestedSlot, booking.slot, ...overlappingSlots]
      .filter((slot): slot is BookingSlotRecord => Boolean(slot))
      .filter(
        (slot, index, collection) =>
          collection.findIndex((candidate) => candidate.id === slot.id) === index,
      ),
    booking.serviceId,
    requestedStartsAt,
    requestedEndsAt,
    requestedSlot?.id ?? booking.slot.id,
  );

  if (
    requestedSlot &&
    publishedCoverage === null &&
    requestedStartsAt >= requestedSlot.startsAt &&
    requestedStartsAt < requestedSlot.endsAt &&
    requestedEndsAt > requestedSlot.endsAt
  ) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.slotTooShort,
      "Vybraný slot už neodpovídá délce služby.",
      "slot",
    );
  }

  let resolvedSlot: BookingSlotRecord | null = publishedCoverage?.anchor ?? null;
  let resolvedCoverageSlots = publishedCoverage?.coverage ?? [];
  let manualOverride = false;
  let preparedManualOverrideSlotIds: string[] = [];

  if (resolvedSlot) {
    const coveredUntil = resolvedCoverageSlots.length > 0
      ? resolvedCoverageSlots[resolvedCoverageSlots.length - 1]?.endsAt ?? resolvedSlot.endsAt
      : resolvedSlot.endsAt;

    if (requestedStartsAt < resolvedSlot.startsAt || requestedEndsAt > coveredUntil) {
      resolvedSlot = null;
      resolvedCoverageSlots = [];
      manualOverride = true;
    } else {
      const isPubliclyAvailable =
        resolvedCoverageSlots.length > 0
        && isWithinPublicWindow;

      if (!isPubliclyAvailable) {
        manualOverride = true;
      }
    }
  } else {
    manualOverride = true;
  }

  if (input.changedByClient && !isWithinPublicWindow) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.slotNotAllowed,
      "Vybraný termín už není dostupný pro online přesun.",
      "slot",
    );
  }

  if (input.changedByClient && manualOverride) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.slotNotAllowed,
      "Vybraný termín není dostupný pro online přesun.",
      "slot",
    );
  }

  if (manualOverride && !input.allowManualOverride) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.slotNotAllowed,
      "Vybraný termín není dostupný pro přesun.",
      "slot",
    );
  }

  const activeBookingCount = await tx.booking.count({
    where: {
      id: {
        not: booking.id,
      },
      status: {
        in: [...ACTIVE_BOOKING_STATUSES],
      },
      scheduledStartsAt: {
        lt: requestedBlockedUntil,
      },
      OR: [
        {
          blockedUntil: {
            gt: requestedStartsAt,
          },
        },
        {
          blockedUntil: null,
          scheduledEndsAt: {
            gt: requestedStartsAt,
          },
        },
      ],
    },
  });

  const allowedCapacity = manualOverride || !resolvedSlot
    ? 1
    : Math.min(...resolvedCoverageSlots.map((coverageSlot) => coverageSlot.capacity));

  if (activeBookingCount >= allowedCapacity) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.conflict,
      "Nový termín koliduje s jinou aktivní rezervací.",
      "slot",
    );
  }

  const preservesAutoLunch = await canPreserveAutoLunchForBooking(tx, {
    requestedStartsAt,
    requestedBlockedUntil,
    excludeBookingId: booking.id,
  });

  if (!preservesAutoLunch && !input.allowManualOverride) {
    throw new BookingRescheduleError(
      bookingRescheduleErrorCodes.slotUnavailable,
      "Vybraný termín už není dostupný.",
      "slot",
    );
  }

  if (!preservesAutoLunch) {
    manualOverride = true;
  }

  if (!resolvedSlot) {
    const manualOverridePreparation = await preparePublishedAvailabilityForManualOverride(
      tx,
      [requestedSlot, booking.slot, ...overlappingSlots].filter(
        (slot): slot is BookingSlotRecord => Boolean(slot),
      ),
      requestedStartsAt,
      requestedBlockedUntil,
      booking.id,
    );

    if (manualOverridePreparation.protectedSlotIds.length > 0) {
      throw new BookingRescheduleError(
        bookingRescheduleErrorCodes.conflict,
        "Nový termín zasahuje do interně blokovaného času.",
        "slot",
      );
    }

    preparedManualOverrideSlotIds = manualOverridePreparation.archivedSlotIds;
    resolvedSlot = await tx.availabilitySlot.create({
      data: {
        startsAt: requestedStartsAt,
        endsAt: requestedBlockedUntil,
        capacity: EDITABLE_SLOT_CAPACITY,
        status: AvailabilitySlotStatus.DRAFT,
        serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.ANY,
        internalNote: input.reason
          ? `Interní výjimka po přesunu: ${normalizeWhitespace(input.reason)}`
          : "Interní výjimka pro přesun rezervace.",
        createdByUserId: input.changedByUserId ?? null,
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        status: true,
        serviceRestrictionMode: true,
        publicNote: true,
        internalNote: true,
        publishedAt: true,
        cancelledAt: true,
        createdByUserId: true,
        allowedServices: {
          select: {
            serviceId: true,
          },
        },
      },
    });
  }

  if (resolvedSlot.status === AvailabilitySlotStatus.PUBLISHED) {
    await splitCoverageSlotsForEditing(
      tx,
      resolvedCoverageSlots.length > 0 ? resolvedCoverageSlots : [resolvedSlot],
      requestedStartsAt,
      requestedEndsAt,
    );
  }

  const normalizedReason = input.reason ? normalizeWhitespace(input.reason) : null;
  const rescheduledAt = new Date();
  const nextCommunicationGeneration = advanceBookingCommunicationGeneration(booking);

  await tx.booking.update({
    where: {
      id: booking.id,
    },
    data: {
      slotId: resolvedSlot.id,
      scheduledStartsAt: requestedStartsAt,
      scheduledEndsAt: requestedEndsAt,
      blockedUntil: requestedBlockedUntil,
      originalAvailabilityEndsAt: resolvedSlot.status === AvailabilitySlotStatus.PUBLISHED
        ? resolvedCoverageSlots.at(-1)?.endsAt ?? resolvedSlot.endsAt
        : null,
      manualOverride,
      communicationGeneration: { increment: 1 },
      rescheduledAt,
      rescheduleCount: {
        increment: 1,
      },
      reminder24hQueuedAt: null,
      reminder24hSentAt: null,
    },
  });

  if (
    booking.status === BookingStatus.CONFIRMED
    && reminderWindowPosition !== "before"
  ) {
    await enqueueBookingReminder24hForBooking(tx, {
      id: booking.id,
      clientId: booking.clientId,
      clientEmailSnapshot: booking.clientEmailSnapshot,
      communicationGeneration: nextCommunicationGeneration,
      clientNameSnapshot: booking.clientNameSnapshot,
      status: booking.status,
      serviceId: booking.serviceId,
      serviceNameSnapshot: booking.serviceNameSnapshot,
      scheduledStartsAt: requestedStartsAt,
      scheduledEndsAt: requestedEndsAt,
    }, now);
  }

  await tx.bookingRescheduleLog.create({
    data: {
      bookingId: booking.id,
      oldStartAt: booking.scheduledStartsAt,
      oldEndAt: booking.scheduledEndsAt,
      newStartAt: requestedStartsAt,
      newEndAt: requestedEndsAt,
      changedByUserId: input.changedByUserId,
      changedByClient: input.changedByClient ?? false,
      reason: normalizedReason,
    },
  });

  if (preparedManualOverrideSlotIds.includes(booking.slotId)) {
    await compactAdjacentEditableSlotsForBooking(tx, booking.slotId);
  } else if (booking.slot.status === AvailabilitySlotStatus.ARCHIVED) {
    if (manualOverride && resolvedSlot.status === AvailabilitySlotStatus.DRAFT) {
      await restoreArchivedSlotAroundManualOverride(tx, booking.slotId, resolvedSlot.id);
    } else {
      await compactAdjacentEditableSlotsForBooking(tx, booking.slotId);
    }
  } else if (booking.manualOverride) {
    await maybeDeleteOrphanedManualOverrideSlot(tx, booking.slotId, booking.id);
  }

  await synchronizeActiveBookingClientActionTokenExpiry(tx, {
    bookingId: booking.id,
    scheduledStartsAt: requestedStartsAt,
    now: rescheduledAt,
  });

  const notificationStatus = input.notifyClient && booking.clientEmailSnapshot.trim().length > 0
    ? await (
        dependencies.createBookingRescheduledClientEmailLog
        ?? createBookingRescheduledClientEmailLog
      )(tx, {
        bookingId: booking.id,
        clientId: booking.clientId,
        serviceId: booking.serviceId,
        communicationGeneration: nextCommunicationGeneration,
        clientEmail: booking.clientEmailSnapshot,
        clientName: booking.clientNameSnapshot,
        serviceName: booking.serviceNameSnapshot,
        previousStartsAt: booking.scheduledStartsAt,
        previousEndsAt: booking.scheduledEndsAt,
        scheduledStartsAt: requestedStartsAt,
        scheduledEndsAt: requestedEndsAt,
        includeCalendarAttachment: input.includeCalendarAttachment ?? true,
        notifyAdminOnClientReschedule: input.changedByClient ?? false,
      })
    : "skipped" as const;

  return {
    bookingId: booking.id,
    serviceId: booking.serviceId,
    communicationGeneration: nextCommunicationGeneration,
    serviceName: booking.serviceNameSnapshot,
    clientId: booking.clientId,
    clientName: booking.clientNameSnapshot,
    clientEmail: booking.clientEmailSnapshot,
    scheduledStartsAt: requestedStartsAt,
    scheduledEndsAt: requestedEndsAt,
    previousStartsAt: booking.scheduledStartsAt,
    previousEndsAt: booking.scheduledEndsAt,
    manualOverride,
    rescheduleCount: booking.rescheduleCount + 1,
    notificationStatus,
  } satisfies RescheduleTransactionResult;
}

const defaultBookingReschedulingDependencies: BookingReschedulingDependencies = {
  prisma,
  getBookingPolicySettings,
  isBookingWithinWindow,
  queueBookingRescheduledNotification,
  sendOwnerBookingPushover,
  sendOwnerSystemErrorPushover,
};

export function createBookingReschedulingApi(
  dependencies: Partial<BookingReschedulingDependencies> = {},
) {
  const resolvedDependencies: BookingReschedulingDependencies = {
    ...defaultBookingReschedulingDependencies,
    ...dependencies,
  };

  return {
    async rescheduleBooking(
      input: RescheduleBookingInput,
    ): Promise<RescheduleBookingResult> {
      const requestedStartsAt = new Date(input.newStartAt);

      if (Number.isNaN(requestedStartsAt.getTime())) {
        throw new BookingRescheduleError(
          bookingRescheduleErrorCodes.invalidDateTime,
          "Vyplňte platný nový datum a čas rezervace.",
          "newTime",
        );
      }

      for (let attempt = 1; attempt <= MAX_BOOKING_TRANSACTION_RETRIES; attempt += 1) {
        try {
          const transactionResult = await resolvedDependencies.prisma.$transaction(
            async (tx) => rescheduleBookingInTransaction(resolvedDependencies, tx, input, requestedStartsAt),
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            },
          );

          if (
            transactionResult.notificationStatus !== "skipped"
            && input.changedByClient
          ) {
            try {
              await resolvedDependencies.queueBookingRescheduledNotification({
                bookingId: transactionResult.bookingId,
                clientId: transactionResult.clientId,
                serviceId: transactionResult.serviceId,
                clientEmail: transactionResult.clientEmail,
                clientName: transactionResult.clientName,
                serviceName: transactionResult.serviceName,
                previousStartsAt: transactionResult.previousStartsAt,
                previousEndsAt: transactionResult.previousEndsAt,
                scheduledStartsAt: transactionResult.scheduledStartsAt,
                scheduledEndsAt: transactionResult.scheduledEndsAt,
                includeCalendarAttachment: input.includeCalendarAttachment ?? true,
                notifyAdminOnClientReschedule: input.changedByClient ?? false,
              });
            } catch (error) {
              console.error("Booking reschedule admin notification enqueue failed", {
                bookingId: transactionResult.bookingId,
                error,
              });
              await resolvedDependencies.sendOwnerSystemErrorPushover({
                title: "PP Studio - systemova chyba",
                message: "Presun rezervace se ulozil, ale nepodarilo se zalozit provozni email notifikaci.",
                context: {
                  contextId: transactionResult.bookingId,
                  bookingId: transactionResult.bookingId,
                },
                error,
              });
            }
          }

          await resolvedDependencies.sendOwnerBookingPushover({
            type: "BOOKING_RESCHEDULED",
            bookingId: transactionResult.bookingId,
            sourceLabel: input.changedByClient ? "Web" : "Admin",
            previousStartsAt: transactionResult.previousStartsAt,
            previousEndsAt: transactionResult.previousEndsAt,
          });

          return {
            bookingId: transactionResult.bookingId,
            scheduledStartsAt: transactionResult.scheduledStartsAt.toISOString(),
            scheduledEndsAt: transactionResult.scheduledEndsAt.toISOString(),
            previousScheduledStartsAt: transactionResult.previousStartsAt.toISOString(),
            previousScheduledEndsAt: transactionResult.previousEndsAt.toISOString(),
            scheduledAtLabel: formatBookingDateLabel(
              transactionResult.scheduledStartsAt,
              transactionResult.scheduledEndsAt,
            ),
            previousScheduledAtLabel: formatBookingDateLabel(
              transactionResult.previousStartsAt,
              transactionResult.previousEndsAt,
            ),
            rescheduleCount: transactionResult.rescheduleCount,
            manualOverride: transactionResult.manualOverride,
            notificationStatus: transactionResult.notificationStatus,
          };
        } catch (error) {
          if (error instanceof BookingRescheduleError) {
            throw error;
          }

          if (isRetryablePrismaError(error) && attempt < MAX_BOOKING_TRANSACTION_RETRIES) {
            continue;
          }

          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            const mappedError = mapKnownPrismaError(error);

            if (mappedError) {
              throw mappedError;
            }
          }

          throw error;
        }
      }

      throw new BookingRescheduleError(
        bookingRescheduleErrorCodes.temporaryFailure,
        "Přesun se teď nepodařilo dokončit kvůli souběžné změně. Zkuste to prosím znovu.",
      );
    },
  };
}

const bookingReschedulingApi = createBookingReschedulingApi();

export const rescheduleBooking = bookingReschedulingApi.rescheduleBooking;
