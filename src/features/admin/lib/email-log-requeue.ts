import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { EmailLog } from "@/generated/prisma/client";
import { getEmailWorkerStaleBefore } from "@/lib/email/booking-delivery-fence";
import { prisma } from "@/lib/prisma";

type RequeueOptions = {
  requireStaleClaim?: boolean;
  now?: Date;
};

export async function requeuePendingEmailLog(
  emailLog: Pick<EmailLog, "id" | "processingStartedAt" | "processingToken">,
  clearError: boolean,
  options: RequeueOptions = {},
) {
  const where: Prisma.EmailLogWhereInput = {
    id: emailLog.id,
    status: "PENDING",
    processingStartedAt: emailLog.processingStartedAt,
    processingToken: emailLog.processingToken,
  };

  if (options.requireStaleClaim) {
    where.AND = [
      { processingStartedAt: { lt: getEmailWorkerStaleBefore(options.now) } },
      { processingToken: { not: null } },
    ];
  }

  const updated = await prisma.emailLog.updateMany({
    where,
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(),
      processingStartedAt: null,
      processingToken: null,
      ...(clearError ? { errorMessage: null } : {}),
    },
  });
  return updated.count === 1;
}
