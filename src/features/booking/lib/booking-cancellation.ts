import {
  BookingActorType,
  BookingActionTokenType,
  BookingSource,
  BookingStatus,
  EmailAudience,
  EmailLogStatus,
  EmailLogType,
  Prisma,
} from "@/generated/prisma/client";

import { env } from "@/config/env";
import { hashBookingActionToken } from "@/features/booking/lib/booking-action-tokens";
import { formatBookingDateLabel } from "@/features/booking/lib/booking-format";
import {
  archiveOrphanedManualOverrideSlotAfterCancellation,
  compactAdjacentEditableSlotsForBooking,
} from "@/features/booking/lib/booking-slot-compaction";
import { sendOwnerBookingPushover } from "@/lib/notifications/pushover";
import { prisma } from "@/lib/prisma";
import {
  ActiveClientDeliveryLeaseError,
  advanceBookingCommunicationGeneration,
  assertNoActiveClientDeliveryLease,
} from "@/lib/email/booking-delivery-fence";
import {
  canClientCancelBooking,
  getBookingPolicySettings,
  getEmailBrandingSettings,
} from "@/lib/site-settings";

const CANCELLABLE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];
const MAX_CANCELLATION_TRANSACTION_RETRIES = 3;

type CancellationPageStateBase = {
  serviceName?: string;
  clientName?: string;
  scheduledAtLabel?: string;
};

export type PublicCancellationPageState =
  | (CancellationPageStateBase & {
      status: "ready";
      expiresAt: string;
    })
  | (CancellationPageStateBase & {
      status: "already_cancelled" | "expired" | "invalid" | "not_cancellable";
      message: string;
    });

export type CancelPublicBookingResult =
  | {
      status: "cancelled";
      serviceName: string;
      clientName: string;
      scheduledAtLabel: string;
      emailDeliveryStatus: "queued" | "logged" | "skipped";
    }
  | {
      status: "already_cancelled" | "expired" | "invalid" | "not_cancellable";
      message: string;
      serviceName?: string;
      clientName?: string;
      scheduledAtLabel?: string;
    }
  | {
      status: "concurrent_modification";
      message: string;
    };

type LoadedCancellationToken = {
  id: string;
  bookingId: string;
  type: BookingActionTokenType;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  booking: {
    id: string;
    status: BookingStatus;
    cancelledAt: Date | null;
    manualOverride: boolean;
    clientId: string;
    slotId: string;
    serviceId: string;
    clientEmailSnapshot: string;
    communicationGeneration: number;
    clientNameSnapshot: string;
    serviceNameSnapshot: string;
    scheduledStartsAt: Date;
    scheduledEndsAt: Date;
    clientDeliveryLeaseToken: string | null;
    clientDeliveryLeaseExpiresAt: Date | null;
    voucherRedemptions: Array<{ id: string }>;
  };
};

function toCancellationDetails(token: LoadedCancellationToken) {
  return {
    bookingId: token.booking.id,
    serviceName: token.booking.serviceNameSnapshot,
    clientName: token.booking.clientNameSnapshot,
    scheduledAtLabel: formatBookingDateLabel(
      token.booking.scheduledStartsAt,
      token.booking.scheduledEndsAt,
    ),
  };
}

function isRetryablePrismaError(error: unknown) {
  const driverAdapterCause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause?: unknown }).cause
      : null;

  return (
    (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) ||
    (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2010" &&
      /Code: [`']40001[`']/.test(error.message)
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

async function findCancellationToken(tokenHash: string) {
  return prisma.bookingActionToken.findUnique({
    where: {
      tokenHash,
    },
    select: {
      id: true,
      bookingId: true,
      type: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      booking: {
        select: {
          id: true,
          status: true,
          cancelledAt: true,
          manualOverride: true,
          clientId: true,
          slotId: true,
          serviceId: true,
          clientEmailSnapshot: true,
          communicationGeneration: true,
          clientNameSnapshot: true,
          serviceNameSnapshot: true,
          scheduledStartsAt: true,
          scheduledEndsAt: true,
          clientDeliveryLeaseToken: true,
          clientDeliveryLeaseExpiresAt: true,
          voucherRedemptions: {
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
}

function resolveCancellationState(
  token: LoadedCancellationToken | null,
  cancellationHours: number,
): PublicCancellationPageState {
  if (!token) {
    return {
      status: "invalid",
      message: "Storno odkaz je neplatný nebo už neexistuje.",
    };
  }

  const details = toCancellationDetails(token);

  if (token.type !== BookingActionTokenType.CANCEL) {
    return {
      status: "invalid",
      message: "Tento odkaz neslouží pro storno rezervace.",
      ...details,
    };
  }

  if (token.revokedAt) {
    return {
      status: "invalid",
      message: "Tento storno odkaz už není aktivní.",
      ...details,
    };
  }

  if (token.expiresAt <= new Date()) {
    return {
      status: "expired",
      message: "Platnost storno odkazu už vypršela. Pokud potřebujete pomoc, kontaktujte salon.",
      ...details,
    };
  }

  if (token.booking.status === BookingStatus.CANCELLED || token.usedAt || token.booking.cancelledAt) {
    return {
      status: "already_cancelled",
      message: "Rezervace už byla dříve zrušena.",
      ...details,
    };
  }

  if (token.booking.voucherRedemptions.length > 0) {
    return {
      status: "not_cancellable",
      message: "Tuto rezervaci nelze zrušit, protože už obsahuje voucherové čerpání. Finanční událost nebyla automaticky odstraněna.",
      ...details,
    };
  }

  if (!CANCELLABLE_BOOKING_STATUSES.includes(token.booking.status)) {
    return {
      status: "not_cancellable",
      message: "Tuto rezervaci už nejde přes storno odkaz upravit. Kontaktujte prosím salon.",
      ...details,
    };
  }

  if (!canClientCancelBooking(token.booking.scheduledStartsAt, new Date(), cancellationHours)) {
    return {
      status: "not_cancellable",
      message: `Online storno už není dostupné méně než ${cancellationHours} hodin před termínem. Kontaktujte prosím salon.`,
      ...details,
    };
  }

  return {
    status: "ready",
    expiresAt: token.expiresAt.toISOString(),
    ...details,
  };
}

export async function getPublicCancellationPageState(rawToken: string): Promise<PublicCancellationPageState> {
  const tokenHash = hashBookingActionToken(rawToken);
  const [token, bookingPolicy] = await Promise.all([
    findCancellationToken(tokenHash),
    getBookingPolicySettings(),
  ]);

  return resolveCancellationState(token, bookingPolicy.cancellationHours);
}

export async function cancelPublicBookingByToken(rawToken: string): Promise<CancelPublicBookingResult> {
  const tokenHash = hashBookingActionToken(rawToken);
  const [bookingPolicy, emailBranding] = await Promise.all([
    getBookingPolicySettings(),
    getEmailBrandingSettings(),
  ]);

  type CancellationTransactionResult =
    | ReturnType<typeof resolveCancellationState>
    | { status: "ready"; details: ReturnType<typeof toCancellationDetails> }
    | { status: "concurrent_modification"; message: string };

  let transactionResult: CancellationTransactionResult | null = null;

  for (let attempt = 1; attempt <= MAX_CANCELLATION_TRANSACTION_RETRIES; attempt += 1) {
    try {
      transactionResult = await prisma.$transaction(
        async (tx) => {
      await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id"
        FROM "BookingActionToken"
        WHERE "tokenHash" = ${tokenHash}
        FOR UPDATE
      `);

      const tokenIdentity = await tx.bookingActionToken.findUnique({
        where: { tokenHash },
        select: { bookingId: true },
      });

      if (tokenIdentity) {
        await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id"
          FROM "Booking"
          WHERE "id" = ${tokenIdentity.bookingId}
          FOR UPDATE
        `);
      }

      const token = await tx.bookingActionToken.findUnique({
        where: {
          tokenHash,
        },
        select: {
          id: true,
          bookingId: true,
          type: true,
          expiresAt: true,
          usedAt: true,
          revokedAt: true,
          booking: {
            select: {
              id: true,
              status: true,
              cancelledAt: true,
              manualOverride: true,
              clientId: true,
              slotId: true,
              serviceId: true,
              clientEmailSnapshot: true,
              communicationGeneration: true,
              clientNameSnapshot: true,
              serviceNameSnapshot: true,
              scheduledStartsAt: true,
              scheduledEndsAt: true,
              clientDeliveryLeaseToken: true,
              clientDeliveryLeaseExpiresAt: true,
              voucherRedemptions: {
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });

      const state = resolveCancellationState(token, bookingPolicy.cancellationHours);

      if (state.status !== "ready") {
        return state;
      }

      const lockedToken = token as LoadedCancellationToken;
      const now = new Date();

      try {
        assertNoActiveClientDeliveryLease(lockedToken.booking, now);
      } catch (error) {
        if (error instanceof ActiveClientDeliveryLeaseError) {
          return {
            status: "concurrent_modification" as const,
            message: "Rezervace se právě zpracovává pro odeslání klientského e-mailu. Zkuste to prosím znovu.",
          };
        }

        throw error;
      }

      const nextCommunicationGeneration = advanceBookingCommunicationGeneration(lockedToken.booking);

      await tx.booking.update({
        where: {
          id: lockedToken.booking.id,
        },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: now,
          communicationGeneration: nextCommunicationGeneration,
        },
      });

      await compactAdjacentEditableSlotsForBooking(tx, lockedToken.booking.slotId);

      if (lockedToken.booking.manualOverride) {
        await archiveOrphanedManualOverrideSlotAfterCancellation(tx, lockedToken.booking.slotId);
      }

      await tx.bookingActionToken.update({
        where: {
          id: lockedToken.id,
        },
        data: {
          usedAt: now,
        },
      });

      await tx.bookingActionToken.updateMany({
        where: {
          bookingId: lockedToken.bookingId,
          type: BookingActionTokenType.CANCEL,
          id: {
            not: lockedToken.id,
          },
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: lockedToken.booking.id,
          status: BookingStatus.CANCELLED,
          actorType: BookingActorType.CLIENT,
          reason: "public-cancellation-flow-v1",
          metadata: {
            source: BookingSource.WEB,
            via: "cancellation-token",
          },
        },
      });

      await tx.emailLog.create({
        data: {
          bookingId: lockedToken.booking.id,
          clientId: lockedToken.booking.clientId,
          actionTokenId: lockedToken.id,
          type: EmailLogType.BOOKING_CANCELLED,
          audience: EmailAudience.CLIENT,
          status: env.EMAIL_DELIVERY_MODE === "background" ? undefined : EmailLogStatus.SENT,
          attemptCount: env.EMAIL_DELIVERY_MODE === "background" ? undefined : 1,
          nextAttemptAt: env.EMAIL_DELIVERY_MODE === "background" ? now : undefined,
          processingStartedAt: null,
          processingToken: null,
          communicationGeneration: nextCommunicationGeneration,
          recipientEmail: lockedToken.booking.clientEmailSnapshot,
          subject: `Storno potvrzeno: ${lockedToken.booking.serviceNameSnapshot}`,
          templateKey: "booking-cancelled-v1",
          payload: {
            bookingId: lockedToken.booking.id,
            serviceId: lockedToken.booking.serviceId,
            serviceName: lockedToken.booking.serviceNameSnapshot,
            clientName: lockedToken.booking.clientNameSnapshot,
            scheduledStartsAt: lockedToken.booking.scheduledStartsAt.toISOString(),
            scheduledEndsAt: lockedToken.booking.scheduledEndsAt.toISOString(),
          },
          provider: env.EMAIL_DELIVERY_MODE === "background" ? undefined : "log",
          sentAt: env.EMAIL_DELIVERY_MODE === "background" ? undefined : now,
        },
      });

      if (emailBranding.notificationAdminEmail.trim().length > 0) {
        await tx.emailLog.create({
          data: {
            bookingId: lockedToken.booking.id,
            clientId: lockedToken.booking.clientId,
            type: EmailLogType.BOOKING_CANCELLED,
            audience: EmailAudience.ADMIN,
            status: env.EMAIL_DELIVERY_MODE === "background" ? undefined : EmailLogStatus.SENT,
            attemptCount: env.EMAIL_DELIVERY_MODE === "background" ? undefined : 1,
            nextAttemptAt: env.EMAIL_DELIVERY_MODE === "background" ? now : undefined,
            processingStartedAt: null,
            processingToken: null,
            recipientEmail: emailBranding.notificationAdminEmail,
            subject: `Zrušená rezervace: ${lockedToken.booking.serviceNameSnapshot}`,
            templateKey: "admin-booking-cancelled-v1",
            payload: {
              bookingId: lockedToken.booking.id,
              serviceName: lockedToken.booking.serviceNameSnapshot,
              clientName: lockedToken.booking.clientNameSnapshot,
              clientEmail: lockedToken.booking.clientEmailSnapshot,
              scheduledStartsAt: lockedToken.booking.scheduledStartsAt.toISOString(),
              scheduledEndsAt: lockedToken.booking.scheduledEndsAt.toISOString(),
            },
            provider: env.EMAIL_DELIVERY_MODE === "background" ? undefined : "log",
            sentAt: env.EMAIL_DELIVERY_MODE === "background" ? undefined : now,
          },
        });
      }

          return {
            status: "ready" as const,
            details: toCancellationDetails(lockedToken),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
      break;
    } catch (error) {
      if (attempt < MAX_CANCELLATION_TRANSACTION_RETRIES && isRetryablePrismaError(error)) {
        continue;
      }
      throw error;
    }
  }

  if (!transactionResult) {
    throw new Error("Cancellation transaction did not produce a result.");
  }

  if (transactionResult.status !== "ready") {
    return transactionResult;
  }

  await sendOwnerBookingPushover({
    type: "BOOKING_CANCELLED",
    bookingId: transactionResult.details.bookingId,
    sourceLabel: "Web",
  });

  return {
    status: "cancelled",
    ...transactionResult.details,
    emailDeliveryStatus:
      (env.EMAIL_DELIVERY_MODE === "background" ? "queued" : "logged") as
        | "queued"
        | "logged",
  };
}
