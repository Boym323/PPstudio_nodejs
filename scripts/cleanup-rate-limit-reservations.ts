import "dotenv/config";

import {
  cleanupExpiredRateLimitReservations,
  RATE_LIMIT_RESERVATION_CLEANUP_BATCH_SIZE,
} from "@/lib/security/rate-limit-reservation-cleanup";
import { prisma } from "@/lib/prisma";

async function main() {
  const deleted = await cleanupExpiredRateLimitReservations();

  console.log(`Odstraněno expirovaných rate-limit rezervací: ${deleted} (dávka max. ${RATE_LIMIT_RESERVATION_CLEANUP_BATCH_SIZE})`);
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error("Úklid rate-limit rezervací selhal", error);
    process.exitCode = 1;
  });
