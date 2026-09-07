import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const actionsDirectory = path.dirname(fileURLToPath(import.meta.url));
const featuresDirectory = path.resolve(actionsDirectory, "../..");

async function readFeatureFile(relativePath: string) {
  return readFile(path.join(featuresDirectory, relativePath), "utf8");
}

test("payment action boundary exports only actions and derives audit actor from the authorized session", async () => {
  const source = await readFeatureFile("booking/payments/actions/booking-payment-actions.ts");

  assert.deepEqual(
    [...source.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
    ["createBookingPaymentAction", "updateBookingPaymentAction", "deleteBookingPaymentAction"],
  );
  assert.match(source, /requireRole\(\[AdminRole\.OWNER\]\)/);
  assert.match(source, /voidedByUserId:\s*session\.sub/);
  assert.doesNotMatch(source, /voidedByUserId:\s*readFormString/);
  assert.doesNotMatch(source, /export async function voidBookingPaymentWithAudit/);
});

test("voucher email action boundary keeps queueing behind the authorized action", async () => {
  const source = await readFeatureFile("admin/actions/voucher-email-actions.ts");

  assert.deepEqual(
    [...source.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
    ["sendVoucherEmailAction"],
  );
  assert.match(source, /requireRole\(\[AdminRole\.OWNER, AdminRole\.SALON\]\)/);
  assert.match(source, /await queueVoucherEmailLog\(/);
  assert.doesNotMatch(source, /export async function queueVoucherEmailLog/);
});

test("internal DB mutation helpers are server-only modules", async () => {
  const [paymentMutationSource, voucherQueueSource] = await Promise.all([
    readFeatureFile("booking/payments/lib/booking-payment-mutations.ts"),
    readFeatureFile("admin/lib/voucher-email-queue.ts"),
  ]);

  assert.match(paymentMutationSource, /^import "server-only";/);
  assert.match(voucherQueueSource, /^import "server-only";/);
});

test("galerie a denní oběd nevystavují interní zápisy jako veřejné server actions", async () => {
  const [gallerySource, settingsSource, galleryMutationSource, lunchMutationSource] = await Promise.all([
    readFeatureFile("admin/actions/service-media-actions.ts"),
    readFeatureFile("admin/actions/settings-actions.ts"),
    readFeatureFile("admin/lib/service-media-mutations.ts"),
    readFeatureFile("admin/lib/admin-auto-lunch.ts"),
  ]);

  assert.doesNotMatch(gallerySource, /export async function createServiceGalleryMediaWithRetry/);
  assert.doesNotMatch(settingsSource, /export async function persistAutoLunchDayMode/);
  assert.match(galleryMutationSource, /^import "server-only";/);
  assert.match(lunchMutationSource, /^import "server-only";/);
});
