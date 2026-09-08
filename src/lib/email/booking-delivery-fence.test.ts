import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";

const fenceModulePromise = import("./booking-delivery-fence");

test("delivery lease rozlišuje aktivní a expirovaný stav", async () => {
  const {
    ActiveClientDeliveryLeaseError,
    assertNoActiveClientDeliveryLease,
    hasActiveClientDeliveryLease,
  } = await fenceModulePromise;
  const now = new Date("2026-08-30T12:00:00.000Z");
  const active = {
    clientDeliveryLeaseToken: "worker-a",
    clientDeliveryLeaseExpiresAt: new Date("2026-08-30T12:01:00.000Z"),
  };
  const expired = {
    clientDeliveryLeaseToken: "worker-a",
    clientDeliveryLeaseExpiresAt: new Date("2026-08-30T11:59:00.000Z"),
  };

  assert.equal(hasActiveClientDeliveryLease(active, now), true);
  assert.equal(hasActiveClientDeliveryLease(expired, now), false);
  assert.throws(
    () => assertNoActiveClientDeliveryLease(active, now),
    ActiveClientDeliveryLeaseError,
  );
  assert.doesNotThrow(() => assertNoActiveClientDeliveryLease(expired, now));
});

test("claim timeout může předběhnout lease, provider timeout ale musí být kratší než lease", async () => {
  const {
    CLIENT_DELIVERY_LEASE_MS,
    EMAIL_PROVIDER_TIMEOUT_MS,
    EMAIL_WORKER_LOCK_TIMEOUT_MS,
    advanceBookingCommunicationGeneration,
  } = await fenceModulePromise;
  assert.ok(EMAIL_WORKER_LOCK_TIMEOUT_MS < CLIENT_DELIVERY_LEASE_MS);
  assert.ok(EMAIL_PROVIDER_TIMEOUT_MS < CLIENT_DELIVERY_LEASE_MS);
  assert.equal(advanceBookingCommunicationGeneration({ communicationGeneration: 7 }), 8);
});

test("stale claim používá stejnou hranici jako worker", async () => {
  const { EMAIL_WORKER_LOCK_TIMEOUT_MS, getEmailWorkerStaleBefore, isEmailWorkerClaimStale } = await fenceModulePromise;
  const now = new Date("2026-09-08T12:00:00.000Z");
  const staleBefore = getEmailWorkerStaleBefore(now);

  assert.equal(isEmailWorkerClaimStale(new Date(staleBefore.getTime() - 1), now), true);
  assert.equal(isEmailWorkerClaimStale(staleBefore, now), false);
  assert.equal(isEmailWorkerClaimStale(new Date(staleBefore.getTime() + 1), now), false);
  assert.equal(isEmailWorkerClaimStale(null, now), false);
  assert.equal(staleBefore.getTime(), now.getTime() - EMAIL_WORKER_LOCK_TIMEOUT_MS);
});
