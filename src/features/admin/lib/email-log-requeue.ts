import "server-only";

import type { EmailLog } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function requeuePendingEmailLog(
  emailLog: Pick<EmailLog, "id" | "processingStartedAt" | "processingToken">,
  clearError: boolean,
) {
  const updated = await prisma.emailLog.updateMany({
    where: {
      id: emailLog.id,
      status: "PENDING",
      processingStartedAt: emailLog.processingStartedAt,
      processingToken: emailLog.processingToken,
    },
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
