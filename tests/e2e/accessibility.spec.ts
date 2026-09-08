import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AdminRole } from "@/generated/prisma/client";

import {
  cleanupE2eData,
  createAdminFixture,
  createPublicBookingFixture,
  prisma,
  type E2eFixture,
} from "./helpers/fixtures";

async function loginAdmin(page: Page, email: string, password: string) {
  await page.goto("/admin/prihlaseni");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(password);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin");
}

async function expectNoAccessibilityViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const results = await builder.analyze();

  expect(results.violations).toEqual([]);
}

async function waitForVisualState(locator: Locator) {
  await expect.poll(
    () =>
      locator.evaluate((element) => {
        const hasActiveAnimation = element
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              animation.playState !== "finished" && animation.playState !== "idle",
          );

        return getComputedStyle(element).opacity === "1" && !hasActiveAnimation;
      }),
    { timeout: 5_000 },
  ).toBe(true);
}

test.describe("přístupnost", () => {
  let fixtures: E2eFixture[] = [];

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test.afterEach(async () => {
    await Promise.all(fixtures.map((fixture) => cleanupE2eData(fixture.runId)));
    fixtures = [];
  });

  test("veřejná domovská stránka nemá porušení pravidel axe", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Kosmetika ve Zlíně" })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test("rezervační formulář nemá porušení axe", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);

    await page.goto(`/rezervace?service=${fixture.serviceSlug}`);
    await expect(page.getByText(fixture.serviceName).first()).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test("administrační dashboard nemá porušení axe", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.OWNER);
    fixtures.push(fixture);

    await loginAdmin(page, admin.email, admin.password);
    await expect(page.getByRole("heading", { name: "Provozní přehled" })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test("admin Radix dialog and dropdown menu have no axe violations and restore focus", async ({ page }) => {
    test.setTimeout(90_000);
    const fixture = await createPublicBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.OWNER);
    fixtures.push(fixture);

    await loginAdmin(page, admin.email, admin.password);
    await page.goto("/admin/uzivatele");

    const inviteTrigger = page.getByRole("button", { name: "Pozvat uživatele" });
    await inviteTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Pozvat uživatele" });
    await expect(dialog).toBeVisible();
    await waitForVisualState(dialog);
    await expectNoAccessibilityViolations(page, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(inviteTrigger).toBeFocused();

    await page.goto("/admin/sluzby");
    const menuTrigger = page.getByRole("button", { name: "Akce služby" }).first();
    await menuTrigger.focus();
    await expect(menuTrigger).toBeFocused();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await waitForVisualState(menu);
    await page.keyboard.press("ArrowDown");
    const focusedMenuItem = menu.locator('[role="menuitem"]:focus');
    await expect(focusedMenuItem).toHaveCount(1);
    await expectNoAccessibilityViolations(page, '[role="menu"]');
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();
  });

  test("akce služby v DropdownMenu odešle server action myší i klávesou Enter", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.OWNER);
    fixtures.push(fixture);

    await loginAdmin(page, admin.email, admin.password);
    await page.goto("/admin/sluzby");

    const service = page.locator("details", { hasText: fixture.serviceName });
    const menuTrigger = service.getByRole("button", { name: "Akce služby" });
    await menuTrigger.click();
    await page.getByRole("menuitem", { name: "Nastavit jako interní" }).click();
    await expect.poll(async () => (await prisma.service.findUniqueOrThrow({ where: { slug: fixture.serviceSlug } })).isPubliclyBookable).toBe(false);

    await expect(page.getByRole("menu")).toHaveCount(0);
    await menuTrigger.click();
    const publicMenuItem = page.getByRole("menuitem", { name: "Nastavit jako veřejnou" });
    await expect(publicMenuItem).toBeVisible();
    await publicMenuItem.focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await prisma.service.findUniqueOrThrow({ where: { slug: fixture.serviceSlug } })).isPubliclyBookable).toBe(true);
  });
});
