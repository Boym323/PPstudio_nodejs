import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.EMAIL_DELIVERY_MODE ??= "log";

const dbTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

dbTest("ruční retry ani uvolnění jobu nepřepíše souběžný výsledek nebo nový claim workeru", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { requeuePendingEmailLog } = await import("./email-log-requeue");

  for (const clearError of [true, false]) {
    for (const status of ["SENT", "FAILED", "PENDING"] as const) {
      const original = await prisma.emailLog.create({ data: {
        type: "GENERIC", audience: "ADMIN", recipientEmail: "audit@example.com",
        subject: "Audit retry", templateKey: "audit", status: "PENDING",
        processingStartedAt: clearError ? null : new Date(),
        processingToken: clearError ? null : "old-worker",
      } });
      try {
        const current = await prisma.emailLog.update({ where: { id: original.id }, data: {
          status,
          processingStartedAt: status === "PENDING" ? new Date() : null,
          processingToken: status === "PENDING" ? "new-worker" : null,
          errorMessage: status === "FAILED" ? "Transport failure" : null,
        } });
        assert.equal(await requeuePendingEmailLog(original, clearError), false);
        assert.deepEqual(await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } }), current);
      } finally {
        await prisma.emailLog.delete({ where: { id: original.id } });
      }
    }
  }
});

dbTest("ruční retry a uvolnění nezměněného pending jobu zachová běžné chování", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { requeuePendingEmailLog } = await import("./email-log-requeue");
  for (const clearError of [true, false]) {
    const original = await prisma.emailLog.create({ data: {
      type: "GENERIC", audience: "ADMIN", recipientEmail: "audit@example.com",
      subject: "Audit retry", templateKey: "audit", status: "PENDING",
      nextAttemptAt: new Date(Date.now() + 60_000), errorMessage: "Předchozí chyba",
      processingStartedAt: clearError ? null : new Date(),
      processingToken: clearError ? null : "old-worker",
    } });
    try {
      assert.equal(await requeuePendingEmailLog(original, clearError), true);
      const current = await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } });
      assert.equal(current.status, "PENDING");
      assert.equal(current.processingToken, null);
      assert.equal(current.processingStartedAt, null);
      assert.ok(current.nextAttemptAt <= new Date());
      assert.equal(current.errorMessage, clearError ? null : original.errorMessage);
    } finally {
      await prisma.emailLog.delete({ where: { id: original.id } });
    }
  }
});
