import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.EMAIL_DELIVERY_MODE ??= "log";

test("serverová autorizace odmítne relaci po absolutním limitu i s platným JWT exp", async (t) => {
  const { prisma } = await import("@/lib/prisma");
  const { resolveSessionFromTokenValue } = await import("./session");
  const { createSessionToken, SESSION_ABSOLUTE_MAX_AGE } = await import("./session-token");
  const originalFindUnique = prisma.adminUser.findUnique;
  const findUser = t.mock.fn(async () => ({
    id: "admin-1", email: "owner@example.com", name: "Owner", role: "OWNER", isActive: true,
  }));
  Object.defineProperty(prisma.adminUser, "findUnique", { configurable: true, value: findUser, writable: true });
  t.after(() => Object.defineProperty(prisma.adminUser, "findUnique", { configurable: true, value: originalFindUnique, writable: true }));
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: "admin-1", email: "owner@example.com", name: "Owner", role: "OWNER" as const };

  const expiredSession = await createSessionToken(payload, {
    nowEpochSeconds: now,
    sessionStartedAt: now - SESSION_ABSOLUTE_MAX_AGE,
  });
  assert.equal(await resolveSessionFromTokenValue(expiredSession), null);
  assert.equal(findUser.mock.callCount(), 0);

  const validSession = await createSessionToken(payload, { nowEpochSeconds: now });
  assert.equal((await resolveSessionFromTokenValue(validSession))?.sub, payload.sub);
  assert.equal(findUser.mock.callCount(), 1);
});
