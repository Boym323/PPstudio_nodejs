import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Lease je uložený na Bookingu, nikoli držený jako PostgreSQL lock přes HTTP
 * request. Mutace bookingové komunikace ho musí respektovat, aby nemohla
 * commitnout novou generaci uprostřed autorizovaného delivery.
 */
export const CLIENT_DELIVERY_LEASE_MS = 15 * 60 * 1000;
/** Claim může být převzat dříve než lease expiruje; delivery pak musí bezpečně deferovat. */
export const EMAIL_WORKER_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
export const CLIENT_DELIVERY_LEASE_BUSY_BUFFER_MS = 5 * 1000;
/** Musí zůstat výrazně kratší než lease, aby po timeoutu zbyl čas na finalizaci v DB. */
export const EMAIL_PROVIDER_TIMEOUT_MS = 30 * 1000;

export function getEmailWorkerStaleBefore(now = new Date()) {
  return new Date(now.getTime() - EMAIL_WORKER_LOCK_TIMEOUT_MS);
}

export function isEmailWorkerClaimStale(
  processingStartedAt: Date | null,
  now = new Date(),
) {
  return processingStartedAt !== null && processingStartedAt < getEmailWorkerStaleBefore(now);
}

export type BookingClientDeliveryLeaseState = {
  clientDeliveryLeaseToken?: string | null;
  clientDeliveryLeaseExpiresAt?: Date | null;
};

export function hasActiveClientDeliveryLease(
  booking: BookingClientDeliveryLeaseState,
  now = new Date(),
) {
  return Boolean(
    booking.clientDeliveryLeaseToken
    && booking.clientDeliveryLeaseExpiresAt
    && booking.clientDeliveryLeaseExpiresAt > now,
  );
}

export class ActiveClientDeliveryLeaseError extends Error {
  readonly code = "CLIENT_DELIVERY_LEASE_ACTIVE";

  constructor(message = "Booking se právě zpracovává pro odeslání klientského e-mailu.") {
    super(message);
    this.name = "ActiveClientDeliveryLeaseError";
  }
}

export function assertNoActiveClientDeliveryLease(
  booking: BookingClientDeliveryLeaseState,
  now = new Date(),
  message?: string,
) {
  if (hasActiveClientDeliveryLease(booking, now)) {
    throw new ActiveClientDeliveryLeaseError(message);
  }
}

export function advanceBookingCommunicationGeneration(booking: { communicationGeneration: number }) {
  return booking.communicationGeneration + 1;
}

export async function acquireClientDeliveryLease(
  tx: Prisma.TransactionClient,
  input: {
    bookingId: string;
    communicationGeneration: number;
    recipientEmail: string;
    leaseToken: string;
    now: Date;
  },
) {
  const claimed = await tx.booking.updateMany({
    where: {
      id: input.bookingId,
      communicationGeneration: input.communicationGeneration,
      clientEmailSnapshot: input.recipientEmail,
      OR: [
        { clientDeliveryLeaseToken: input.leaseToken },
        { clientDeliveryLeaseToken: null },
        { clientDeliveryLeaseExpiresAt: { lte: input.now } },
      ],
    },
    data: {
      clientDeliveryLeaseToken: input.leaseToken,
      clientDeliveryLeaseExpiresAt: new Date(input.now.getTime() + CLIENT_DELIVERY_LEASE_MS),
    },
  });

  return claimed.count === 1;
}

export async function releaseClientDeliveryLease(
  bookingId: string,
  leaseToken: string,
) {
  return prisma.booking.updateMany({
    where: {
      id: bookingId,
      clientDeliveryLeaseToken: leaseToken,
    },
    data: {
      clientDeliveryLeaseToken: null,
      clientDeliveryLeaseExpiresAt: null,
    },
  });
}
