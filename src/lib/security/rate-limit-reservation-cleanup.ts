import { prisma } from "@/lib/prisma";

export const RATE_LIMIT_RESERVATION_CLEANUP_BATCH_SIZE = 500;

type RawExecutor = {
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number | bigint>;
};

/** Deletes one small, oldest-first batch. Repeating the call is safe. */
export async function cleanupExpiredRateLimitReservations(
  db: RawExecutor = prisma,
  now = new Date(),
) {
  const deleted = await db.$executeRaw`
    DELETE FROM "RateLimitReservation"
    WHERE "id" IN (
      SELECT "id"
      FROM "RateLimitReservation"
      WHERE "expiresAt" <= ${now}
      ORDER BY "expiresAt", "id"
      LIMIT ${RATE_LIMIT_RESERVATION_CLEANUP_BATCH_SIZE}
    )
  `;

  return Number(deleted);
}
