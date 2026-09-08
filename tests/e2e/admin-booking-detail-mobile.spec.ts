import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import { AdminRole } from "@/generated/prisma/client";

import {
  cleanupE2eData,
  createAdminFixture,
  createManagedBookingFixture,
  prisma,
} from "./helpers/fixtures";

test.describe("mobilní detail rezervace", () => {
  let runId = "";

  test.afterEach(async () => {
    if (runId) {
      await cleanupE2eData(runId);
    }
  });

  test("poznámka, platba a drawer přesunu zůstávají použitelné na 390×844", async ({ page }) => {
    test.setTimeout(90_000);
    runId = `booking-detail-mobile-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const fixture = await createManagedBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.OWNER);
    runId = fixture.runId;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/prihlaseni");
    await page.getByLabel("E-mail").fill(admin.email);
    await page.getByLabel("Heslo").fill(admin.password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await expect(page).toHaveURL(/\/admin/);

    await page.goto(`/admin/rezervace/${fixture.bookingId}`);
    await expect(page.locator("main")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.locator("details", { hasText: "Přidat poznámku" }).locator("summary").click();
    const note = `Mobilní poznámka ${fixture.runId}`;
    await page.locator('textarea[name="internalNote"]').fill(note);
    await page.getByRole("button", { name: "Přidat poznámku" }).last().click();
    await expect.poll(async () => (await prisma.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } })).internalNote).toBe(note);

    const paymentPanel = page.locator("details", { hasText: "Zapsat platbu" });
    const paymentSummary = paymentPanel.locator("summary");
    await paymentSummary.click();
    if (await paymentPanel.getAttribute("open") === null) {
      await paymentSummary.press("Enter");
    }
    await expect(paymentPanel).toHaveAttribute("open", "");
    await paymentPanel.getByLabel("Částka").fill("100");
    await paymentPanel.getByLabel("Poznámka").fill(`Mobilní platba ${fixture.runId}`);
    await paymentPanel.getByRole("button", { name: "Zapsat platbu" }).click();
    await expect.poll(() => prisma.bookingPayment.count({ where: { bookingId: fixture.bookingId } })).toBe(1);

    const rescheduleTrigger = page.getByRole("button", { name: "Přesunout termín" }).first();
    await rescheduleTrigger.click();
    const rescheduleDialog = page.getByRole("dialog", { name: "Změnit termín rezervace" });
    await expect(rescheduleDialog).toBeVisible();
    const submit = page.getByRole("button", { name: /Potvrdit přesun|Přesunout termín/ }).last();
    await expect(submit).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(rescheduleDialog).toHaveCount(0);
    await expect(rescheduleTrigger).toBeFocused();
  });
});
