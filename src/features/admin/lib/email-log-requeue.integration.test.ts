import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";

import { EMAIL_WORKER_LOCK_TIMEOUT_MS } from "@/lib/email/booking-delivery-fence";

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

dbTest("uvolnění fresh claimu odmítne a zachová worker state", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { requeuePendingEmailLog } = await import("./email-log-requeue");
  const now = new Date();
  const processingStartedAt = new Date(now.getTime() - 30_000);
  const original = await prisma.emailLog.create({ data: {
    type: "GENERIC", audience: "ADMIN", recipientEmail: "fresh-claim@example.com",
    subject: "Fresh claim release", templateKey: "fresh-claim", status: "PENDING",
    processingStartedAt, processingToken: "fresh-worker",
  } });

  try {
    const before = await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(await requeuePendingEmailLog(before, false, { requireStaleClaim: true, now }), false);
    assert.deepEqual(await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } }), before);
  } finally {
    await prisma.emailLog.delete({ where: { id: original.id } });
  }
});

dbTest("uvolnění stale claimu atomicky vrátí job do fronty", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { requeuePendingEmailLog } = await import("./email-log-requeue");
  const now = new Date();
  const processingStartedAt = new Date(now.getTime() - EMAIL_WORKER_LOCK_TIMEOUT_MS - 1_000);
  const original = await prisma.emailLog.create({ data: {
    type: "GENERIC", audience: "ADMIN", recipientEmail: "stale-claim@example.com",
    subject: "Stale claim release", templateKey: "stale-claim", status: "PENDING",
    processingStartedAt, processingToken: "stale-worker",
  } });

  try {
    const before = await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(await requeuePendingEmailLog(before, false, { requireStaleClaim: true, now }), true);
    const after = await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(after.status, "PENDING");
    assert.equal(after.processingStartedAt, null);
    assert.equal(after.processingToken, null);
    assert.ok(after.nextAttemptAt <= new Date());
  } finally {
    await prisma.emailLog.delete({ where: { id: original.id } });
  }
});

dbTest("uvolnění stale snapshotu nepřepíše nový claim workeru ani SENT stav", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { requeuePendingEmailLog } = await import("./email-log-requeue");
  const now = new Date();
  const staleStartedAt = new Date(now.getTime() - EMAIL_WORKER_LOCK_TIMEOUT_MS - 1_000);
  const original = await prisma.emailLog.create({ data: {
    type: "GENERIC", audience: "ADMIN", recipientEmail: "concurrent-claim@example.com",
    subject: "Concurrent claim release", templateKey: "concurrent-claim", status: "PENDING",
    processingStartedAt: staleStartedAt, processingToken: "old-worker",
  } });

  try {
    const staleSnapshot = await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } });
    const takeover = await prisma.emailLog.update({ where: { id: original.id }, data: {
      processingStartedAt: new Date(), processingToken: "new-worker",
    } });
    assert.equal(await requeuePendingEmailLog(staleSnapshot, false, { requireStaleClaim: true, now }), false);
    assert.deepEqual(await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } }), takeover);

    const sent = await prisma.emailLog.update({ where: { id: original.id }, data: {
      status: "SENT", processingStartedAt: null, processingToken: null, sentAt: new Date(),
    } });
    assert.equal(await requeuePendingEmailLog(staleSnapshot, false, { requireStaleClaim: true, now }), false);
    assert.deepEqual(await prisma.emailLog.findUniqueOrThrow({ where: { id: original.id } }), sent);
  } finally {
    await prisma.emailLog.delete({ where: { id: original.id } });
  }
});

dbTest("detail e-mailu označí pouze stale claim jako zaseknutý a uvolnitelný", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { getEmailLogDetailData } = await import("./data/email-logs");
  const now = new Date();
  const fresh = await prisma.emailLog.create({ data: {
    type: "GENERIC", audience: "ADMIN", recipientEmail: "fresh-detail@example.com",
    subject: "Fresh detail claim", templateKey: "fresh-detail", status: "PENDING",
    processingStartedAt: new Date(now.getTime() - 30_000), processingToken: "fresh-detail-worker",
  } });
  const stale = await prisma.emailLog.create({ data: {
    type: "GENERIC", audience: "ADMIN", recipientEmail: "stale-detail@example.com",
    subject: "Stale detail claim", templateKey: "stale-detail", status: "PENDING",
    processingStartedAt: new Date(now.getTime() - EMAIL_WORKER_LOCK_TIMEOUT_MS - 1_000), processingToken: "stale-detail-worker",
  } });

  try {
    const [freshDetail, staleDetail] = await Promise.all([
      getEmailLogDetailData(fresh.id),
      getEmailLogDetailData(stale.id),
    ]);
    assert.equal(freshDetail?.isStuck, false);
    assert.equal(freshDetail?.canRelease, false);
    assert.equal(staleDetail?.isStuck, true);
    assert.equal(staleDetail?.canRelease, true);
  } finally {
    await prisma.emailLog.deleteMany({ where: { id: { in: [fresh.id, stale.id] } } });
  }
});
