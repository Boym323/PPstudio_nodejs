import assert from "node:assert/strict";
import test from "node:test";

test("rate-limit cleanup deletes only one bounded expired batch", async () => {
  process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
  process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
  process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
  const {
    cleanupExpiredRateLimitReservations,
    RATE_LIMIT_RESERVATION_CLEANUP_BATCH_SIZE,
  } = await import("./rate-limit-reservation-cleanup");
  const now = new Date("2026-09-07T10:00:00.000Z");
  let query = "";
  let values: unknown[] = [];

  const deleted = await cleanupExpiredRateLimitReservations({
    $executeRaw: async (strings, ...queryValues) => {
      query = strings.join("?");
      values = queryValues;
      return RATE_LIMIT_RESERVATION_CLEANUP_BATCH_SIZE;
    },
  }, now);

  assert.equal(deleted, RATE_LIMIT_RESERVATION_CLEANUP_BATCH_SIZE);
  assert.match(query, /DELETE FROM "RateLimitReservation"/);
  assert.match(query, /ORDER BY "expiresAt", "id"/);
  assert.match(query, /LIMIT \?/);
  assert.deepEqual(values, [now, RATE_LIMIT_RESERVATION_CLEANUP_BATCH_SIZE]);
});
