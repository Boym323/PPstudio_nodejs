import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { AdminRole } from "@/generated/prisma/browser";

process.env.NEXT_PUBLIC_APP_NAME ??= "PP Studio";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.ADMIN_OWNER_PASSWORD ??= "change-me-owner";
process.env.ADMIN_STAFF_EMAIL ??= "staff@example.com";
process.env.ADMIN_STAFF_PASSWORD ??= "change-me-staff";
process.env.EMAIL_DELIVERY_MODE ??= "log";

const dbTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

dbTest("souběžné AUTO/OFF pro stejný cíl uloží jediný override a jediný audit", async () => {
  const [{ prisma }, { persistAutoLunchDayMode }, { runSerializableTransaction }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/features/admin/lib/admin-auto-lunch"),
    import("@/lib/serializable-transaction"),
  ]);
  const suffix = randomUUID().slice(0, 8);
  const dateKey = "2028-10-02";
  const actor = await prisma.adminUser.create({
    data: { email: `auto-lunch-race-${suffix}@example.com`, name: `Auto lunch ${suffix}`, role: AdminRole.OWNER, isActive: true },
    select: { id: true, role: true },
  });

  try {
    const input = { area: "owner" as const, dateKey, mode: "OFF" as const, actor };
    const changes = await Promise.all([
      runSerializableTransaction((tx) => persistAutoLunchDayMode(tx, input)),
      runSerializableTransaction((tx) => persistAutoLunchDayMode(tx, input)),
    ]);

    assert.deepEqual(changes.sort(), [false, true]);
    assert.equal(await prisma.autoLunchDayOverride.count({ where: { dateKey } }), 1);
    assert.equal(await prisma.availabilityAuditEvent.count({ where: { dateKey, source: "auto-lunch-day-override-v1" } }), 1);
  } finally {
    await prisma.availabilityAuditEvent.deleteMany({ where: { dateKey, source: "auto-lunch-day-override-v1" } });
    await prisma.autoLunchDayOverride.deleteMany({ where: { dateKey } });
    await prisma.adminUser.delete({ where: { id: actor.id } });
  }
});
