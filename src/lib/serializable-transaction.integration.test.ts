import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.EMAIL_DELIVERY_MODE ??= "log";

const dbTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

dbTest("serializovatelná transakce zopakuje skutečný konflikt PostgreSQL při FOR UPDATE", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { runSerializableTransaction } = await import("./serializable-transaction");
  const category = await prisma.serviceCategory.create({ data: { slug: `retry-${randomUUID()}`, name: "Původní" } });

  try {
    let attempts = 0;
    const name = await runSerializableTransaction(async (tx) => {
      attempts += 1;
      // Ustálí snapshot před souběžným commitem jiného spojení.
      await tx.serviceCategory.findUniqueOrThrow({ where: { id: category.id } });
      if (attempts === 1) {
        await prisma.serviceCategory.update({ where: { id: category.id }, data: { name: "Souběžná změna" } });
      }
      await tx.$queryRaw`SELECT "id" FROM "ServiceCategory" WHERE "id" = ${category.id} FOR UPDATE`;
      return (await tx.serviceCategory.findUniqueOrThrow({ where: { id: category.id } })).name;
    });

    assert.equal(attempts, 2);
    assert.equal(name, "Souběžná změna");
  } finally {
    await prisma.serviceCategory.delete({ where: { id: category.id } });
  }
});
