import { EmailLogStatus, Prisma } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";

import {
  BOOKING_REMINDER_SCAN_INTERVAL_MS,
  enqueueBookingReminder24hJobs,
} from "@/features/booking/lib/booking-reminders";
import { deliverEmailLog } from "@/lib/email/delivery";
import { EMAIL_WORKER_LOCK_TIMEOUT_MS } from "@/lib/email/booking-delivery-fence";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredRateLimitReservations } from "@/lib/security/rate-limit-reservation-cleanup";

const WORKER_BATCH_SIZE = 10;
const WORKER_IDLE_DELAY_MS = 5_000;
const MAX_ITERATIONS_PER_RUN = 1_000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 15 * 60 * 1_000;

export type EmailWorkerConfig = {
  once?: boolean;
};

type ClaimedEmailLog = {
  id: string;
  processingToken: string;
};

async function claimDueEmailLogs(limit: number): Promise<ClaimedEmailLog[]> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - EMAIL_WORKER_LOCK_TIMEOUT_MS);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "EmailLog"
      WHERE "status" = ${EmailLogStatus.PENDING}
        AND "nextAttemptAt" <= ${now}
        AND ("processingStartedAt" IS NULL OR "processingStartedAt" < ${staleBefore})
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);

    const claimed: ClaimedEmailLog[] = [];

    for (const row of rows) {
      const processingToken = randomUUID();
      const updated = await tx.emailLog.update({
        where: {
          id: row.id,
        },
        data: {
          attemptCount: {
            increment: 1,
          },
          processingStartedAt: now,
          processingToken,
        },
        select: {
          id: true,
          processingToken: true,
        },
      });

      const claimedProcessingToken = updated.processingToken;
      if (!claimedProcessingToken) {
        throw new Error(`Claim e-mailu ${updated.id} nevytvořil processing token.`);
      }

      claimed.push({
        id: updated.id,
        processingToken: claimedProcessingToken,
      });
    }

    return claimed;
  });
}

export async function runEmailDeliveryWorkerOnce() {
  let processed = 0;

  while (processed < MAX_ITERATIONS_PER_RUN) {
    const batch = await claimDueEmailLogs(WORKER_BATCH_SIZE);

    if (batch.length === 0) {
      break;
    }

    for (const emailLog of batch) {
      await deliverEmailLog(emailLog.id, emailLog.processingToken);
      processed += 1;
    }
  }

  return processed;
}

export async function runBookingReminderSchedulerOnce(now = new Date()) {
  const result = await enqueueBookingReminder24hJobs(now);

  console.info("Booking reminder 24h scan finished", {
    at: now.toISOString(),
    foundBookings: result.foundBookings,
    enqueued: result.enqueued,
    failed: result.failed,
  });

  return result;
}

export async function runRateLimitReservationCleanupOnce(now = new Date()) {
  const deleted = await cleanupExpiredRateLimitReservations(prisma, now);

  if (deleted > 0) {
    console.info("Rate-limit reservation cleanup finished", {
      at: now.toISOString(),
      deleted,
    });
  }

  return deleted;
}

export async function startEmailDeliveryWorker() {
  let nextReminderScanAt = 0;
  let nextRateLimitCleanupAt = 0;

  while (true) {
    const now = Date.now();

    if (now >= nextReminderScanAt) {
      await runBookingReminderSchedulerOnce(new Date(now));
      nextReminderScanAt = now + BOOKING_REMINDER_SCAN_INTERVAL_MS;
    }

    if (now >= nextRateLimitCleanupAt) {
      try {
        await runRateLimitReservationCleanupOnce(new Date(now));
      } catch (error) {
        console.error("Rate-limit reservation cleanup failed", error);
      }
      nextRateLimitCleanupAt = now + RATE_LIMIT_CLEANUP_INTERVAL_MS;
    }

    const processed = await runEmailDeliveryWorkerOnce();

    if (processed === 0) {
      await new Promise((resolve) => setTimeout(resolve, WORKER_IDLE_DELAY_MS));
    }
  }
}
