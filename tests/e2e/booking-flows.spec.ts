import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AdminRole,
  AvailabilitySlotServiceRestrictionMode,
  AvailabilitySlotStatus,
  BookingActorType,
  BookingSource,
  BookingStatus,
} from "@/generated/prisma/client";

import {
  cleanupE2eData,
  createAdminFixture,
  createManagedBookingFixture,
  createPublicBookingFixture,
  createPublicVoucherFixture,
  prisma,
  type E2eFixture,
} from "./helpers/fixtures";

async function selectSlotById(
  page: Page,
  slotButtonLabel: string,
  expectedSlotId: string,
  actionButton: Locator,
) {
  const normalizeSlotLabel = (value: string) =>
    value.normalize("NFKC").replace(/[–—-]/g, "-").replace(/\s+/g, " ").trim();
  const exactSlotButtonLabel = slotButtonLabel.replace(
    /^(Vybrat čas \d{2}:\d{2}) - (\d{2}:\d{2} dne )/,
    "$1 – $2",
  );
  const exactSlotButton = page.getByRole("button", { name: exactSlotButtonLabel });
  const slotDateLabelMatch = slotButtonLabel.match(/ dne (.+)$/);
  const slotDateLabel = slotDateLabelMatch?.[1];

  if ((await exactSlotButton.count()) === 0 && slotDateLabel) {
    const dateButton = page.getByRole("button", { name: `Vybrat den ${slotDateLabel}` });

    if ((await dateButton.count()) > 0) {
      await dateButton.click();
      await expect(page.getByRole("button", { name: /^Vybrat čas / }).first()).toBeVisible();
    }
  }

  const normalizedExpectedLabel = normalizeSlotLabel(exactSlotButtonLabel);
  await expect.poll(async () => {
    const label = await exactSlotButton.getAttribute("aria-label");
    return label ? normalizeSlotLabel(label) : "";
  }).toBe(normalizedExpectedLabel);
  await expect(exactSlotButton).toBeVisible();
  await expect(exactSlotButton).toBeEnabled();
  await exactSlotButton.dispatchEvent("click");
  await expect.poll(async () => page.locator('input[name="slotId"]').inputValue()).toBe(expectedSlotId);
  await expect(actionButton).toBeEnabled();
}

function getCalendarDateButtonLabel(slotButtonLabel: string) {
  const dateKey = slotButtonLabel.match(/^Vybrat termín (\d{4}-\d{2}-\d{2}) \d{2}:\d{2}$/)?.[1];

  if (!dateKey) {
    throw new Error(`Termín nemá očekávaný přístupný popisek: ${slotButtonLabel}`);
  }

  return `Vybrat den ${new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Prague",
  }).format(new Date(`${dateKey}T12:00:00.000Z`))}`;
}

function getCalendarMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  return new Intl.DateTimeFormat("cs-CZ", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Prague",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}

async function navigateCalendarToDate(page: Page, slotButtonLabel: string) {
  const dateKey = slotButtonLabel.match(/^Vybrat termín (\d{4}-\d{2}-\d{2}) \d{2}:\d{2}$/)?.[1];

  if (!dateKey) {
    throw new Error(`Termín nemá očekávaný přístupný popisek: ${slotButtonLabel}`);
  }

  const calendarCard = page.getByRole("button", { name: "Další měsíc" }).locator("xpath=../../..");
  const monthLabel = calendarCard.locator("p").nth(1);
  await expect(monthLabel).toBeVisible();
  const currentMonthLabel = (await monthLabel.textContent())?.trim();
  const [targetYear, targetMonth] = dateKey.slice(0, 7).split("-").map(Number);
  const currentMonthOffset = Array.from({ length: 25 }, (_, index) => index - 12).find((offset) => {
    const candidate = new Date(Date.UTC(targetYear, targetMonth - 1 + offset, 1, 12));
    const candidateKey = `${candidate.getUTCFullYear()}-${String(candidate.getUTCMonth() + 1).padStart(2, "0")}`;
    return getCalendarMonthLabel(candidateKey) === currentMonthLabel;
  });

  if (currentMonthOffset === undefined) {
    throw new Error(`Kalendář má neočekávaný měsíc: ${currentMonthLabel ?? ""}`);
  }

  const monthButtonName = currentMonthOffset < 0 ? "Další měsíc" : "Předchozí měsíc";
  const monthButton = calendarCard.getByRole("button", { name: monthButtonName });
  const targetMonthLabel = getCalendarMonthLabel(dateKey.slice(0, 7));

  for (let attempt = 0; attempt < Math.abs(currentMonthOffset); attempt += 1) {
    await expect(monthButton).toBeEnabled();
    await monthButton.click();
    await expect(monthLabel).not.toHaveText(currentMonthLabel ?? "");
  }

  await expect(monthLabel).toHaveText(targetMonthLabel);
  const dateButton = calendarCard.getByRole("button", { name: getCalendarDateButtonLabel(slotButtonLabel) });
  await expect(dateButton).toBeVisible();
  await expect(dateButton).toBeEnabled();
  return dateButton;
}

async function selectAvailableSlot(
  page: Page,
  actionButton: Locator,
  excludedSelections: Set<string> = new Set(),
) {
  const slotButtons = page.getByRole("button", { name: /^Vybrat čas / });
  const buttonCount = await slotButtons.count();

  for (let index = 0; index < buttonCount; index += 1) {
    const candidate = slotButtons.nth(index);
    await expect(candidate).toBeVisible();
    await expect(candidate).toBeEnabled();
    await candidate.dispatchEvent("click");
    await expect(candidate).toHaveAttribute("aria-pressed", "true");

    const slotId = await page.locator('input[name="slotId"]').inputValue();
    const startsAt = await page.locator('input[name="newStartAt"]').inputValue();
    const selectionKey = `${slotId}:${startsAt}`;

    if (excludedSelections.has(selectionKey) || !(await actionButton.isEnabled())) {
      continue;
    }

    return {
      slotId,
      startsAt,
      selectionKey,
    };
  }

  throw new Error("Nepodařilo se vybrat žádný použitelný dostupný slot pro přesun rezervace.");
}

async function submitRescheduleUntilSuccess(
  page: Page,
  confirmButton: Locator,
  successHeading: Locator,
  conflictMessage: Locator,
  attemptedSlotIds: Set<string>,
) {
  const slotButtons = page.getByRole("button", { name: /^Vybrat čas / });
  const buttonCount = await slotButtons.count();

  for (let index = 0; index < buttonCount; index += 1) {
    const candidate = slotButtons.nth(index);
    await expect(candidate).toBeVisible();
    await expect(candidate).toBeEnabled();
    await candidate.dispatchEvent("click");
    await expect(candidate).toHaveAttribute("aria-pressed", "true");

    if ((await successHeading.count()) > 0) {
      return;
    }

    const slotInput = page.locator('input[name="slotId"]');
    if ((await slotInput.count()) === 0) {
      continue;
    }

    let slotId: string;
    try {
      slotId = await slotInput.first().inputValue({ timeout: 1_000 });
    } catch {
      continue;
    }

    if (attemptedSlotIds.has(slotId) || !(await confirmButton.isEnabled())) {
      continue;
    }

    attemptedSlotIds.add(slotId);
    await confirmButton.click();

    try {
      await expect(successHeading).toBeVisible({ timeout: 2_000 });
      return;
    } catch {
      if ((await conflictMessage.count()) > 0) {
        continue;
      }
    }
  }
}

async function expectSelectedRescheduleSlot(
  page: Page,
  expected: {
    slotId: string;
    startsAt: string;
  },
) {
  await expect.poll(async () => ({
    slotId: await page.locator('input[name="slotId"]').inputValue(),
    startsAt: await page.locator('input[name="newStartAt"]').inputValue(),
  })).toEqual(expected);
}

async function clickUntilFocused(trigger: Locator, target: Locator) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await trigger.click();

    try {
      await expect(target).toBeFocused({ timeout: 1_000 });
      return;
    } catch {
      await trigger.page().waitForTimeout(250);
    }
  }

  await expect(target).toBeFocused();
}

async function selectPublicSlotAndFocus(page: Page, slotLabel: string, target: Locator) {
  const suggestedButton = page.getByRole("button", { name: slotLabel }).first();

  if (await suggestedButton.count() > 0 && await suggestedButton.isVisible()) {
    await clickUntilFocused(suggestedButton, target);
    return;
  }

  const dateButton = await navigateCalendarToDate(page, slotLabel);
  await dateButton.click();
  const calendarButton = page.getByRole("button", { name: slotLabel }).last();
  await expect(calendarButton).toBeVisible();
  await expect(calendarButton).toBeEnabled();
  await clickUntilFocused(calendarButton, target);
}

async function installMetaPixelSpy(page: Page) {
  await page.addInitScript(() => {
    window.__metaPixelCalls = [];
  });
}

async function installMatomoSpy(page: Page) {
  await page.addInitScript(() => {
    const calls: unknown[][] = [];

    const queue = {
      push(payload: unknown[]) {
        calls.push(payload);
        return calls.length;
      },
    };

    Object.defineProperty(window, "__matomoCalls", {
      configurable: true,
      value: calls,
      writable: true,
    });

    Object.defineProperty(window, "_paq", {
      configurable: true,
      get() {
        return queue;
      },
      set(value) {
        if (Array.isArray(value)) {
          for (const payload of value) {
            if (Array.isArray(payload)) {
              calls.push(payload);
            }
          }
        }
      },
    });
  });

}

async function getMetaPixelEventNames(page: Page) {
  return page.evaluate(() => {
    const calls = (window as Window & { __metaPixelCalls?: unknown[][] }).__metaPixelCalls ?? [];

    return calls.map((call) => `${String(call[0])}:${String(call[1])}`);
  });
}

async function getMatomoCalls(page: Page) {
  return page.evaluate(() => {
    const calls = (window as Window & { __matomoCalls?: unknown[][] }).__matomoCalls ?? [];

    return calls.map((call) => call.map((value) => String(value)));
  });
}

type MatomoRequest = {
  endpoint: string;
  params: Record<string, string>;
};

async function installMatomoRequestSpy(page: Page) {
  const requests: MatomoRequest[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());

    if (url.hostname !== "matomo.example.test" || url.pathname !== "/matomo.php") {
      return;
    }

    requests.push({
      endpoint: `${url.origin}${url.pathname}`,
      params: Object.fromEntries(url.searchParams.entries()),
    });
  });

  await page.route("**/matomo.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        (() => {
          const queue = window._paq || [];
          let endpoint = '';
          let siteId = '';
          let customUrl = '';
          const visitorId = 'e2e-visitor-id';

          const emit = (params) => {
            const image = new Image();
            image.src = endpoint + '?' + new URLSearchParams({
              idsite: siteId,
              rec: '1',
              _id: visitorId,
              url: customUrl,
              ...params,
            }).toString();
          };

          const handle = (command) => {
            switch (command[0]) {
              case 'setTrackerUrl': endpoint = command[1]; break;
              case 'setSiteId': siteId = command[1]; break;
              case 'setCustomUrl': customUrl = command[1]; break;
              case 'trackPageView': emit({ action_name: document.title }); break;
              case 'trackEvent': emit({ e_c: command[1], e_a: command[2], e_n: command[3] || '' }); break;
              default: break;
            }
          };

          queue.forEach(handle);
          window._paq = { push(command) { handle(command); return 1; } };
        })();
      `,
    });
  });
  await page.route("**/matomo.php**", async (route) => {
    await route.fulfill({ status: 204 });
  });

  return requests;
}

async function expectMetaPixelEvent(page: Page, eventName: string) {
  await expect
    .poll(async () => getMetaPixelEventNames(page))
    .toContain(eventName);
}

async function loginAdmin(page: Page, email: string, password: string) {
  await page.goto("/admin/prihlaseni");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(password);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/admin" || url.pathname === "/admin/provoz",
    { timeout: 30_000 },
  );
}

function selectedClientCard(page: Page) {
  return page.getByRole("group", { name: "Vybraná klientka" });
}

async function safeClick(page: Page, locator: Locator) {
  await locator.dispatchEvent("click");
  await page.waitForTimeout(100);
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function formatPragueTime(value: Date) {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  }).format(value);
}

function formatPragueDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Prague",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not format Prague date key for ${value.toISOString()}`);
  }

  return `${year}-${month}-${day}`;
}

function buildPublicSlotButtonLabel(startsAt: Date) {
  return `Vybrat termín ${formatPragueDateKey(startsAt)} ${formatPragueTime(startsAt)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function roundUpToHalfHour(value: Date) {
  const copy = new Date(value);
  copy.setUTCSeconds(0, 0);
  const minutes = copy.getUTCMinutes();

  if (minutes === 0 || minutes === 30) {
    return copy;
  }

  if (minutes < 30) {
    copy.setUTCMinutes(30, 0, 0);
    return copy;
  }

  copy.setUTCHours(copy.getUTCHours() + 1, 0, 0, 0);
  return copy;
}

async function findIsolatedE2eWindow(durationMinutes: number) {
  const siteSettings = await prisma.siteSettings.findUnique({
    where: { id: "site-settings" },
    select: {
      bookingMinAdvanceHours: true,
      bookingMaxAdvanceDays: true,
    },
  });
  const minAdvanceHours = siteSettings?.bookingMinAdvanceHours ?? 2;
  const maxAdvanceDays = siteSettings?.bookingMaxAdvanceDays ?? 90;
  const now = new Date();
  const quietDayStart = addMinutes(now, 14 * 24 * 60);
  quietDayStart.setUTCHours(8, 0, 0, 0);
  const policySafeStart = addMinutes(now, (minAdvanceHours + 10) * 60);
  const searchStart = roundUpToHalfHour(policySafeStart > quietDayStart ? policySafeStart : quietDayStart);
  const latestStart = roundUpToHalfHour(addMinutes(
    new Date(),
    maxAdvanceDays * 24 * 60 - durationMinutes,
  ));
  const latestEnd = addMinutes(latestStart, durationMinutes);
  const [slots, bookings] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where: { startsAt: { lt: latestEnd }, endsAt: { gt: searchStart } },
      select: { startsAt: true, endsAt: true },
    }),
    prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        scheduledStartsAt: { lt: latestEnd },
        OR: [
          { blockedUntil: { gt: searchStart } },
          { blockedUntil: null, scheduledEndsAt: { gt: searchStart } },
        ],
      },
      select: { scheduledStartsAt: true, blockedUntil: true, scheduledEndsAt: true },
    }),
  ]);

  for (let dayOffset = 0; ; dayOffset += 1) {
    const startsAt = addMinutes(searchStart, dayOffset * 24 * 60);

    if (startsAt > latestStart) {
      break;
    }

    const endsAt = addMinutes(startsAt, durationMinutes);
    const dateKey = formatPragueDateKey(startsAt);
    const hasOtherDayData = slots.some((slot) => formatPragueDateKey(slot.startsAt) === dateKey)
      || bookings.some((booking) => formatPragueDateKey(booking.scheduledStartsAt) === dateKey);
    const slotConflict = slots.some((slot) => slot.startsAt < endsAt && slot.endsAt > startsAt);
    const bookingConflict = bookings.some((booking) => {
      const blockedUntil = booking.blockedUntil ?? booking.scheduledEndsAt;
      return booking.scheduledStartsAt < endsAt && blockedUntil > startsAt;
    });

    if (!hasOtherDayData && !slotConflict && !bookingConflict) {
      return { startsAt, endsAt };
    }
  }

  throw new Error("Nepodařilo se najít izolované E2E okno dostupnosti.");
}

test.describe("rezervační toky", () => {
  let fixtures: E2eFixture[] = [];

  test.afterEach(async () => {
    await Promise.all(fixtures.map((fixture) => cleanupE2eData(fixture.runId)));
    fixtures = [];
  });

  test("veřejný návštěvník vytvoří čekající rezervaci", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);

    await page.goto(`/rezervace?service=${fixture.serviceSlug}`);
    await expect(page.getByText(fixture.serviceName).first()).toBeVisible();
    await clickUntilFocused(
      page.getByRole("button", { name: /^Vybrat termín / }).first(),
      page.getByLabel("Jméno a příjmení"),
    );
    await page.getByLabel("Jméno a příjmení").fill(fixture.clientName);
    await page.getByRole("textbox", { name: "E-mail" }).fill(fixture.clientEmail);
    await page.getByRole("textbox", { name: "Telefon" }).fill("+420 777 000 000");
    await page.getByRole("button", { name: "Zobrazit souhrn" }).click();
    await page.getByRole("button", { name: "Odeslat rezervaci" }).first().click();

    await expect(page.getByRole("heading", { name: "Rezervace přijata" })).toBeVisible();
    await expect(page.getByText("Čeká na finální potvrzení")).toBeVisible();
    await expect(page.getByText(fixture.serviceName)).toBeVisible();
    await expect(page.getByRole("link", { name: "Změnit termín" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Zrušit rezervaci" })).toHaveCount(0);

    const booking = await prisma.booking.findFirstOrThrow({
      where: {
        clientEmailSnapshot: fixture.clientEmail,
      },
      include: {
        actionTokens: true,
      },
    });

    expect(booking.status).toBe(BookingStatus.PENDING);
    expect(booking.actionTokens.map((token) => token.type).sort()).toEqual([
      "APPROVE",
      "CANCEL",
      "REJECT",
      "RESCHEDULE",
    ]);
  });

  test("Matomo bootstrap tracks the first pageview once and tracks SPA navigations", async ({ page }) => {
    const matomoRequests = await installMatomoRequestSpy(page);

    await page.goto("/");
    await expect.poll(
      () =>
        matomoRequests.filter(
          (request) => request.params.url === "/" && !request.params.e_a,
        ).length,
    ).toBe(1);

    const servicesLink = page.locator('footer a[href="/sluzby"]:visible');
    await expect(servicesLink).toHaveCount(1);
    await servicesLink.click();
    await expect(page).toHaveURL(/\/sluzby/);
    await expect.poll(
      () =>
        matomoRequests.filter(
          (request) => request.params.url === "/sluzby" && !request.params.e_a,
        ).length,
    ).toBe(1);

    expect(matomoRequests.every((request) => request.endpoint === "https://matomo.example.test/matomo.php")).toBe(true);
    expect(matomoRequests.every((request) => request.params.idsite === "1")).toBe(true);
    expect(matomoRequests.every((request) => request.params._id === "e2e-visitor-id")).toBe(true);
  });

  test("Matomo keeps the first booking pageview and prefilled booking events in one visit", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);
    const matomoRequests = await installMatomoRequestSpy(page);

    await page.goto(`/rezervace?service=${fixture.serviceSlug}`);
    await expect(page.getByText(fixture.serviceName).first()).toBeVisible();

    await expect.poll(
      () => matomoRequests
        .filter((request) => request.params.url === `/rezervace?service=${fixture.serviceSlug}`)
        .filter((request) => request.params.e_a)
        .map((request) => request.params.e_a),
    ).toEqual(expect.arrayContaining(["Rezervace zahájena", "Služba vybrána"]));

    const bookingRequests = matomoRequests.filter(
      (request) => request.params.url === `/rezervace?service=${fixture.serviceSlug}`,
    );
    const pageviews = bookingRequests.filter((request) => !request.params.e_a);
    const events = bookingRequests.filter((request) => request.params.e_a);

    expect(pageviews).toHaveLength(1);
    expect(events.map((request) => request.params.e_a)).toEqual(
      expect.arrayContaining(["Rezervace zahájena", "Služba vybrána"]),
    );
    expect(bookingRequests.every((request) => request.endpoint === "https://matomo.example.test/matomo.php")).toBe(true);
    expect(bookingRequests.every((request) => request.params.idsite === "1")).toBe(true);
    expect(bookingRequests.every((request) => request.params._id === "e2e-visitor-id")).toBe(true);
    expect(events.every((request) => request.params.new_visit === undefined)).toBe(true);
  });

  test("Matomo rozlišuje klik na doporučenou kartu od stejného času z kalendáře", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);
    await installMatomoSpy(page);

    await page.goto(`/rezervace?service=${fixture.serviceSlug}`);
    const suggestedSection = page.getByRole("heading", { name: "Doporučené termíny" }).locator("xpath=ancestor::section[1]");
    const suggestedButton = suggestedSection.getByRole("button").first();
    await expect(suggestedButton).toBeVisible();
    const suggestedLabel = await suggestedButton.getAttribute("aria-label");

    if (!suggestedLabel) {
      throw new Error("Doporučený termín nemá očekávaný přístupný popisek.");
    }

    await page.getByRole("button", { name: getCalendarDateButtonLabel(suggestedLabel) }).click();
    const calendarButton = page
      .getByRole("heading", { name: "Dostupné časy" })
      .locator("xpath=ancestor::div[@tabindex='-1']")
      .getByRole("button", { name: suggestedLabel })
      .first();
    await calendarButton.click();
    await expect(calendarButton).toHaveAttribute("aria-pressed", "true");

    await expect.poll(async () => {
      const calls = await getMatomoCalls(page);
      return calls.filter((call) => call[0] === "trackEvent" && call[2] === "Čas vybrán").length;
    }).toBe(1);
    let events = (await getMatomoCalls(page)).filter((call) => call[0] === "trackEvent");
    expect(events.filter((call) => call[2] === "Doporučený termín vybrán")).toHaveLength(0);

    await page.waitForTimeout(350);
    const currentSuggestedButton = suggestedSection
      .getByRole("button", { name: suggestedLabel })
      .first();
    await expect(currentSuggestedButton).toBeVisible();
    await expect(currentSuggestedButton).toBeEnabled();
    await currentSuggestedButton.dispatchEvent("click");
    await expect.poll(async () => {
      const calls = await getMatomoCalls(page);
      return calls.filter((call) => call[0] === "trackEvent" && call[2] === "Doporučený termín vybrán").length;
    }).toBe(1);
    events = (await getMatomoCalls(page)).filter((call) => call[0] === "trackEvent");
    expect(events.filter((call) => call[2] === "Čas vybrán")).toHaveLength(1);
    expect(events).toContainEqual([
      "trackEvent",
      "Rezervace",
      "Doporučený termín vybrán",
      expect.stringMatching(/\| pozice 1$/),
    ]);
  });

  test("mobilní skryté doporučení nelze měřit jako klik na doporučenou kartu", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);
    await page.setViewportSize({ width: 390, height: 844 });
    await installMatomoSpy(page);

    await page.goto(`/rezervace?service=${fixture.serviceSlug}`);
    const suggestedSection = page.getByRole("heading", { name: "Doporučené termíny" }).locator("xpath=ancestor::section[1]");
    const suggestedButtons = suggestedSection.getByRole("button", { includeHidden: true });
    await expect(suggestedButtons).toHaveCount(6);
    await expect(suggestedButtons.nth(0)).toBeVisible();
    await expect(suggestedButtons.nth(1)).toBeVisible();
    await expect(suggestedButtons.nth(2)).toBeVisible();
    await expect(suggestedButtons.nth(3)).toBeVisible();
    await expect(suggestedButtons.nth(4)).toBeHidden();
    await expect(suggestedButtons.nth(5)).toBeHidden();
    const hiddenSuggestedLabel = await suggestedButtons.nth(4).getAttribute("aria-label");

    if (!hiddenSuggestedLabel) {
      throw new Error("Skrytý doporučený termín nemá očekávaný přístupný popisek.");
    }

    const hiddenSuggestedDateButton = await navigateCalendarToDate(page, hiddenSuggestedLabel);
    await hiddenSuggestedDateButton.click();
    const calendarTimeButton = page
      .getByRole("heading", { name: "Dostupné časy" })
      .locator("xpath=ancestor::div[@tabindex='-1']")
      .getByRole("button", { name: hiddenSuggestedLabel })
      .first();
    await expect(calendarTimeButton).toBeVisible();
    await expect(calendarTimeButton).toBeEnabled();
    await calendarTimeButton.click();
    await expect.poll(async () => {
      const calls = await getMatomoCalls(page);
      return calls.filter((call) => call[0] === "trackEvent" && call[2] === "Čas vybrán").length;
    }).toBe(1);
    const events = (await getMatomoCalls(page)).filter((call) => call[0] === "trackEvent");
    expect(events.filter((call) => call[2] === "Doporučený termín vybrán")).toHaveLength(0);
  });

  test("obnovení po konfliktu znovu ověří voucher před možností odeslat nový termín", async ({ browser }) => {
    // Dvě nezávislé relace zde záměrně provádějí několik serverových akcí
    // včetně předepsaného zpoždění pro reprodukci konfliktu.
    test.setTimeout(90_000);

    const fixture = await createPublicBookingFixture();
    const voucherFixture = await createPublicVoucherFixture();
    fixtures.push(fixture, voucherFixture);

    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    const bookingPath = `/rezervace?service=${fixture.serviceSlug}`;
    const primarySlotLabel = buildPublicSlotButtonLabel(new Date(fixture.slotLabels.primaryStartAt));

    const fillBookingContact = async (page: Page, suffix: string) => {
      await page.getByLabel("Jméno a příjmení").fill(`${fixture.clientName} ${suffix}`);
      await page.getByRole("textbox", { name: "E-mail" }).fill(`${fixture.runId}-${suffix}@example.test`);
      await page.getByRole("textbox", { name: "Telefon" }).fill("+420 777 000 000");
    };

    try {
      await firstPage.goto(bookingPath);
      await selectPublicSlotAndFocus(
        firstPage,
        primarySlotLabel,
        firstPage.getByLabel("Jméno a příjmení"),
      );
      await fillBookingContact(firstPage, "first");
      await firstPage.getByLabel("Kód voucheru").fill(voucherFixture.voucherCode ?? "");
      await expect(firstPage.getByText("Voucher je použitelný: Hodnotový poukaz.")).toBeVisible();

      await secondPage.goto(bookingPath);
      await selectPublicSlotAndFocus(
        secondPage,
        primarySlotLabel,
        secondPage.getByLabel("Jméno a příjmení"),
      );
      await fillBookingContact(secondPage, "second");
      await secondPage.getByRole("button", { name: "Odeslat rezervaci" }).first().click();
      await expect(secondPage.getByRole("heading", { name: "Rezervace přijata" })).toBeVisible();

      const actionRequestCounts = new Map<string, number>();
      const delayedActionId = { value: undefined as string | undefined };
      await firstPage.route("**/*", async (route) => {
        const actionId = route.request().headers()["next-action"];

        if (actionId) {
          actionRequestCounts.set(actionId, (actionRequestCounts.get(actionId) ?? 0) + 1);
          if (!delayedActionId.value || actionId === delayedActionId.value) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
        await route.continue();
      });

      const firstSubmit = firstPage.getByRole("button", { name: "Odeslat rezervaci" }).first();
      const firstSubmissionRequest = firstPage.waitForRequest((request) => Boolean(request.headers()["next-action"]));
      await firstSubmit.click();
      const bookingActionId = (await firstSubmissionRequest).headers()["next-action"];
      delayedActionId.value = bookingActionId;
      await expect(firstPage.getByText("Tento termín byl mezitím obsazen. Nabídku jsme aktualizovali, vyberte prosím jiný čas.")).toBeVisible();
      await expect(firstPage.getByRole("button", { name: primarySlotLabel })).toHaveCount(0);
      if (await firstSubmit.count() > 0) {
        await expect(firstSubmit).toBeDisabled();
      } else {
        await expect(firstSubmit).toHaveCount(0);
      }
      await expect(firstPage.getByText("Voucher je použitelný: Hodnotový poukaz.")).toBeVisible();

      const candidateSlots = firstPage.getByRole("button", { name: /^Vybrat termín / });
      const candidateCount = await candidateSlots.count();
      let selectedNewTerm = false;

      for (let index = 0; index < candidateCount; index += 1) {
        const candidate = candidateSlots.nth(index);
        if (await candidate.getAttribute("aria-label") === primarySlotLabel) {
          continue;
        }
        await clickUntilFocused(candidate, firstPage.getByLabel("Jméno a příjmení"));
        if (await firstSubmit.isEnabled()) {
          selectedNewTerm = true;
          break;
        }
      }

      expect(selectedNewTerm).toBe(true);
      const nonBookingActionCounts = new Map(
        [...actionRequestCounts].filter(([actionId]) => actionId !== bookingActionId),
      );
      await firstSubmit.click();
      await expect(firstPage.getByRole("heading", { name: "Rezervace přijata" })).toBeVisible();
      expect(actionRequestCounts.get(bookingActionId)).toBe(2);
      expect(
        [...actionRequestCounts].filter(([actionId]) => actionId !== bookingActionId),
      ).toEqual([...nonBookingActionCounts]);
    } finally {
      await firstContext.close();
      await secondContext.close();
    }
  });

  test("public booking availability respects cleanup block while keeping client-visible service end", async ({ page }) => {
    const runId = `e2e-cleanup-${Date.now().toString(36)}`;
    const fixture: E2eFixture = {
      runId,
      serviceName: "",
      serviceSlug: "",
      categoryName: "",
      clientName: "",
      clientEmail: "",
      slotLabels: {
        primaryDateKey: "",
        primaryTime: "",
        rescheduleDateKey: "",
        rescheduleTime: "",
        rescheduleConflictButtonLabel: "",
        rescheduleConflictSlotId: "",
        rescheduleSuccessButtonLabel: "",
        rescheduleSuccessSlotId: "",
        rescheduleSuccessStartAt: "",
        primaryStartAt: "",
        rescheduleStartAt: "",
      },
    };
    fixtures.push(fixture);

    const categoryName = `E2E cleanup category ${runId}`;
    const serviceName = `E2E cleanup service ${runId}`;
    const serviceSlug = slugify(serviceName);
    const serviceDurationMinutes = 60;
    const servicePriceFromCzk = 900;

    const category = await prisma.serviceCategory.create({
      data: {
        name: categoryName,
        slug: slugify(categoryName),
        publicName: categoryName,
        description: "Dočasná E2E kategorie pro cleanup scénář.",
        sortOrder: -10_000,
        pricingSortOrder: -10_000,
        isActive: true,
      },
    });

    const service = await prisma.service.create({
      data: {
        categoryId: category.id,
        name: serviceName,
        publicName: serviceName,
        slug: serviceSlug,
        shortDescription: "Dočasná E2E služba pro cleanup scénář.",
        publicIntro: "Dočasná E2E služba pro cleanup scénář.",
        description: "Dočasná E2E služba pro cleanup scénář.",
        seoDescription: "Dočasná E2E služba pro cleanup scénář.",
        durationMinutes: serviceDurationMinutes,
        cleanupMinutes: 10,
        priceFromCzk: servicePriceFromCzk,
        sortOrder: -10_000,
        isActive: true,
        isPubliclyBookable: true,
      },
    });

    fixture.serviceName = serviceName;
    fixture.serviceSlug = serviceSlug;
    fixture.categoryName = categoryName;

    const slotDurationMinutes = 4 * 60;
    const { startsAt: blockedBookingStart } = await findIsolatedE2eWindow(slotDurationMinutes);
    const blockedBookingEnd = addMinutes(blockedBookingStart, serviceDurationMinutes);
    const blockedUntil = addMinutes(blockedBookingEnd, 15);
    const releasedStart = blockedUntil;
    const releasedServiceEnd = addMinutes(releasedStart, serviceDurationMinutes);

    const slot = await prisma.availabilitySlot.create({
      data: {
        startsAt: blockedBookingStart,
        endsAt: addMinutes(blockedBookingStart, 4 * 60),
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.SELECTED,
        publishedAt: new Date(),
        publicNote: `E2E cleanup ${runId}`,
        allowedServices: {
          create: {
            serviceId: service.id,
          },
        },
      },
    });

    const client = await prisma.client.create({
      data: {
        fullName: `E2E Cleanup Client ${runId}`,
        email: `${runId}-cleanup-client@example.test`,
        phone: "+420777000003",
        lastBookedAt: blockedBookingStart,
      },
    });

    await prisma.booking.create({
      data: {
        clientId: client.id,
        slotId: slot.id,
        serviceId: service.id,
        source: BookingSource.WEB,
        status: BookingStatus.CONFIRMED,
        clientNameSnapshot: client.fullName,
        clientEmailSnapshot: client.email ?? `${runId}-cleanup-client@example.test`,
        clientPhoneSnapshot: client.phone,
        serviceNameSnapshot: service.name,
        serviceDurationMinutes,
        servicePriceFromCzk,
        cleanupMinutes: 10,
        cleanupBlockMinutes: 15,
        scheduledStartsAt: blockedBookingStart,
        scheduledEndsAt: blockedBookingEnd,
        blockedUntil,
        confirmedAt: new Date(),
        statusHistory: {
          create: {
            status: BookingStatus.CONFIRMED,
            actorType: BookingActorType.SYSTEM,
            note: "E2E cleanup block booking",
          },
        },
      },
    });

    await page.goto(`/rezervace?service=${serviceSlug}`);
    await expect(page.getByText(serviceName).first()).toBeVisible();

    const blockedStartButton = page
      .getByRole("button", { name: buildPublicSlotButtonLabel(blockedBookingEnd) });
    const blockedStartCount = await blockedStartButton.count();
    if (blockedStartCount > 0) {
      await expect(blockedStartButton.first()).toBeDisabled();
    }

    const releasedStartButton = page
      .getByRole("button", { name: buildPublicSlotButtonLabel(releasedStart) })
      .first();
    if (await releasedStartButton.count() === 0) {
      const releasedDateButton = await navigateCalendarToDate(
        page,
        buildPublicSlotButtonLabel(releasedStart),
      );
      await releasedDateButton.click();
    }
    await expect(releasedStartButton).toBeVisible();
    await expect(releasedStartButton).toBeEnabled();
    await clickUntilFocused(releasedStartButton, page.getByLabel("Jméno a příjmení"));

    await expect(page.getByText(`Konec ${formatPragueTime(releasedServiceEnd)}`)).toBeVisible();
    await expect(page.getByText(new RegExp(`${serviceDurationMinutes}\\s*min`)).first()).toBeVisible();
    await expect(page.getByText("Úklid po službě")).toHaveCount(0);
    await expect(page.getByText("Interně blokováno do")).toHaveCount(0);
  });

  test("public booking allows the last client-visible start in a slot even when cleanup overflows past slot end", async ({ page }) => {
    const runId = `e2e-cleanup-overflow-${Date.now().toString(36)}`;
    const fixture: E2eFixture = {
      runId,
      serviceName: "",
      serviceSlug: "",
      categoryName: "",
      clientName: "",
      clientEmail: "",
      slotLabels: {
        primaryDateKey: "",
        primaryTime: "",
        rescheduleDateKey: "",
        rescheduleTime: "",
        rescheduleConflictButtonLabel: "",
        rescheduleConflictSlotId: "",
        rescheduleSuccessButtonLabel: "",
        rescheduleSuccessSlotId: "",
        rescheduleSuccessStartAt: "",
        primaryStartAt: "",
        rescheduleStartAt: "",
      },
    };
    fixtures.push(fixture);

    const categoryName = `E2E cleanup overflow category ${runId}`;
    const serviceName = `E2E cleanup overflow service ${runId}`;
    const serviceSlug = slugify(serviceName);
    const serviceDurationMinutes = 60;
    const servicePriceFromCzk = 900;

    const category = await prisma.serviceCategory.create({
      data: {
        name: categoryName,
        slug: slugify(categoryName),
        publicName: categoryName,
        description: "Dočasná E2E kategorie pro cleanup overflow scénář.",
        sortOrder: -10_000,
        pricingSortOrder: -10_000,
        isActive: true,
      },
    });

    const service = await prisma.service.create({
      data: {
        categoryId: category.id,
        name: serviceName,
        publicName: serviceName,
        slug: serviceSlug,
        shortDescription: "Dočasná E2E služba pro cleanup overflow scénář.",
        publicIntro: "Dočasná E2E služba pro cleanup overflow scénář.",
        description: "Dočasná E2E služba pro cleanup overflow scénář.",
        seoDescription: "Dočasná E2E služba pro cleanup overflow scénář.",
        durationMinutes: serviceDurationMinutes,
        cleanupMinutes: 10,
        priceFromCzk: servicePriceFromCzk,
        sortOrder: -10_000,
        isActive: true,
        isPubliclyBookable: true,
      },
    });

    fixture.serviceName = serviceName;
    fixture.serviceSlug = serviceSlug;
    fixture.categoryName = categoryName;

    const slotDurationMinutes = 60;
    const { startsAt: slotStart } = await findIsolatedE2eWindow(slotDurationMinutes);
    const slotEnd = addMinutes(slotStart, slotDurationMinutes);

    await prisma.availabilitySlot.create({
      data: {
        startsAt: slotStart,
        endsAt: slotEnd,
        capacity: 1,
        status: AvailabilitySlotStatus.PUBLISHED,
        serviceRestrictionMode: AvailabilitySlotServiceRestrictionMode.SELECTED,
        publishedAt: new Date(),
        publicNote: `E2E cleanup overflow primary ${runId}`,
        allowedServices: {
          create: {
            serviceId: service.id,
          },
        },
      },
    });

    await page.goto(`/rezervace?service=${serviceSlug}`);
    await expect(page.getByText(serviceName).first()).toBeVisible();

    const slotStartButton = page
      .getByRole("button", { name: buildPublicSlotButtonLabel(slotStart) })
      .first();
    if (await slotStartButton.count() === 0) {
      const slotDateButton = await navigateCalendarToDate(
        page,
        buildPublicSlotButtonLabel(slotStart),
      );
      await slotDateButton.click();
    }
    await expect(slotStartButton).toBeVisible();
    await expect(slotStartButton).toBeEnabled();
    await clickUntilFocused(slotStartButton, page.getByLabel("Jméno a příjmení"));

    await expect(page.getByText(`Konec ${formatPragueTime(slotEnd)}`)).toBeVisible();
    await expect(page.getByText(new RegExp(`${serviceDurationMinutes}\\s*min`)).first()).toBeVisible();
    await expect(page.getByText("Úklid po službě")).toHaveCount(0);
    await expect(page.getByText("Interně blokováno do")).toHaveCount(0);
  });

  test("platný slug služby předvybere službu a zachová marketingové parametry", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);

    const service = await prisma.service.findFirstOrThrow({
      where: {
        slug: fixture.serviceSlug,
      },
      select: {
        id: true,
      },
    });

    await page.goto(
      `/rezervace?service=${fixture.serviceSlug}&utm_source=instagram&utm_medium=social&mtm_campaign=jaro-2026`,
    );

    await expect(page.locator('input[name="serviceId"]')).toHaveValue(service.id);
    await expect(page.getByText(fixture.serviceName).first()).toBeVisible();

    const currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("service")).toBe(fixture.serviceSlug);
    expect(currentUrl.searchParams.get("utm_source")).toBe("instagram");
    expect(currentUrl.searchParams.get("utm_medium")).toBe("social");
    expect(currentUrl.searchParams.get("mtm_campaign")).toBe("jaro-2026");
  });

  test("neznámý slug služby je bezpečně ignorován", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);

    await page.goto("/rezervace?service=neznamy-slug");

    await expect(page.locator('input[name="serviceId"]')).toHaveValue("");
    await page.locator('button[aria-pressed]').filter({ hasText: fixture.categoryName }).first().click();
    await expect(page.getByText(fixture.serviceName).first()).toBeVisible();
  });

  test("neaktivní nebo neveřejný slug služby se nepředvybere", async ({ page }) => {
    const inactiveFixture = await createPublicBookingFixture();
    const fallbackFixture = await createPublicBookingFixture();
    fixtures.push(inactiveFixture, fallbackFixture);

    const targetService = await prisma.service.findFirstOrThrow({
      where: {
        slug: inactiveFixture.serviceSlug,
      },
      select: {
        id: true,
      },
    });

    await prisma.service.update({
      where: {
        id: targetService.id,
      },
      data: {
        isActive: false,
      },
    });

    await page.goto(`/rezervace?service=${inactiveFixture.serviceSlug}`);
    await expect(page.locator('input[name="serviceId"]')).toHaveValue("");
    await page.locator('button[aria-pressed]').filter({ hasText: fallbackFixture.categoryName }).first().click();
    await expect(page.getByText(fallbackFixture.serviceName).first()).toBeVisible();

    await prisma.service.update({
      where: {
        id: targetService.id,
      },
      data: {
        isActive: true,
        isPubliclyBookable: false,
      },
    });

    await page.goto(`/rezervace?service=${inactiveFixture.serviceSlug}`);
    await expect(page.locator('input[name="serviceId"]')).toHaveValue("");
    await page.locator('button[aria-pressed]').filter({ hasText: fallbackFixture.categoryName }).first().click();
    await expect(page.getByText(fallbackFixture.serviceName).first()).toBeVisible();
  });

  test("service detail links to booking with the service slug", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);

    await page.goto(`/sluzby/${fixture.serviceSlug}`);

    await expect(page.getByRole("link", { name: "Rezervovat službu" })).toHaveAttribute(
      "href",
      `/rezervace?service=${fixture.serviceSlug}&source=service_detail`,
    );
  });

  test("service detail CTA opens booking with preselected service and immediate slot selection", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);

    const service = await prisma.service.findFirstOrThrow({
      where: {
        slug: fixture.serviceSlug,
      },
      select: {
        id: true,
      },
    });

    await page.goto(`/sluzby/${fixture.serviceSlug}`);
    await page.getByRole("link", { name: "Rezervovat službu" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/rezervace\\?service=${fixture.serviceSlug}&source=service_detail$`),
    );
    await expect(page.locator('input[name="serviceId"]')).toHaveValue(service.id);
    await expect(page.locator("main").getByText(fixture.serviceName).first()).toBeVisible();

    const firstSlotButton = page.getByRole("button", { name: /^Vybrat termín / }).first();
    await expect(firstSlotButton).toBeVisible();
    await clickUntilFocused(firstSlotButton, page.getByLabel("Jméno a příjmení"));
  });

  test("service detail CTA drives the Meta Pixel funnel through booking success", async ({ page }) => {
    const fixture = await createPublicBookingFixture();
    fixtures.push(fixture);

    await installMetaPixelSpy(page);
    await page.route("**/fbevents.js", async (route) => {
      await route.fulfill({
        contentType: "application/javascript",
        body: "// Meta Pixel is stubbed for Playwright smoke coverage.",
      });
    });

    await page.goto(`/sluzby/${fixture.serviceSlug}`);
    await expect(page.getByRole("heading", { name: fixture.serviceName })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-meta-pixel-view-content", fixture.serviceSlug, {
      timeout: 30_000,
    });
    await expectMetaPixelEvent(page, "track:ViewContent");

    await page.getByRole("link", { name: "Rezervovat službu" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/rezervace\\?service=${fixture.serviceSlug}&source=service_detail$`),
    );
    await expectMetaPixelEvent(page, "trackCustom:BookingServiceSelected");
    await expect.poll(async () => getMetaPixelEventNames(page)).not.toContain("track:AddToCart");
    await expect.poll(async () => getMetaPixelEventNames(page)).not.toContain("track:InitiateCheckout");

    await clickUntilFocused(
      page.getByRole("button", { name: /^Vybrat termín / }).first(),
      page.getByLabel("Jméno a příjmení"),
    );
    await expectMetaPixelEvent(page, "track:InitiateCheckout");
    await expectMetaPixelEvent(page, "trackCustom:BookingDateSelected");
    await expectMetaPixelEvent(page, "trackCustom:BookingTimeSelected");
    await expectMetaPixelEvent(page, "trackCustom:BookingContactStarted");

    await page.getByLabel("Jméno a příjmení").fill(fixture.clientName);
    await page.getByRole("textbox", { name: "E-mail" }).fill(fixture.clientEmail);
    await page.getByRole("textbox", { name: "Telefon" }).fill("+420 777 000 000");
    await page.getByRole("button", { name: "Zobrazit souhrn" }).click();
    await page.getByRole("button", { name: "Odeslat rezervaci" }).first().click();

    await expect(page.getByRole("heading", { name: "Rezervace přijata" })).toBeVisible();
    await expectMetaPixelEvent(page, "track:Schedule");
    await expect.poll(async () => getMetaPixelEventNames(page)).toEqual([
      "track:ViewContent",
      "trackCustom:BookingServiceSelected",
      "trackCustom:BookingDateSelected",
      "trackCustom:BookingTimeSelected",
      "track:InitiateCheckout",
      "trackCustom:BookingContactStarted",
      "track:Schedule",
    ]);
    await expect.poll(async () => getMetaPixelEventNames(page)).not.toContain("track:AddToCart");
    await expect.poll(async () => getMetaPixelEventNames(page)).not.toContain("track:Lead");

    const calls = await page.evaluate(() => (
      (window as Window & { __metaPixelCalls?: unknown[][] }).__metaPixelCalls ?? []
    ));
    expect(JSON.stringify(calls)).not.toContain(fixture.clientName);
    expect(JSON.stringify(calls)).not.toContain(fixture.clientEmail);
    expect(JSON.stringify(calls)).not.toContain("777 000 000");
    expect(JSON.stringify(calls)).not.toMatch(/note|voucher|token/i);
  });

  test("veřejný návštěvník bezpečně ověří kód voucheru", async ({ page }) => {
    const fixture = await createPublicVoucherFixture();
    fixtures.push(fixture);

    await page.goto(`/vouchery/overeni?code=${fixture.voucherCode}`);

    await expect(page.getByRole("heading", { name: "Ověření dárkového poukazu" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByLabel("Kód voucheru")).toHaveValue(fixture.voucherCode ?? "");
    await expect(page.getByText("Voucher je platný")).toBeVisible();
    await expect(page.getByText("Hodnotový poukaz")).toBeVisible();
    await expect(page.getByText(/1\s*500\s*Kč/)).toBeVisible();
    await expect(page.getByText(fixture.voucherCode ?? "")).toBeVisible();
    await expect(page.getByText("secret.example.test")).toHaveCount(0);
    await expect(page.getByText("E2E tajná poznámka")).toHaveCount(0);
  });

  test("klient zruší rezervaci pomocí veřejného tokenu a odešle pouze bezpečné události Matomo", async ({ page }) => {
    const fixture = await createManagedBookingFixture();
    fixtures.push(fixture);

    await installMatomoSpy(page);
    await page.route("**/matomo.js", async (route) => {
      await route.fulfill({
        contentType: "application/javascript",
        body: "// Matomo is stubbed for Playwright smoke coverage.",
      });
    });

    await page.goto(`/rezervace/storno/${fixture.cancelToken}`);
    await expect(page.getByRole("heading", { name: "Opravdu chcete zrušit rezervaci?" })).toBeVisible();

    await expect.poll(async () => getMatomoCalls(page)).toContainEqual([
      "setCustomUrl",
      "/rezervace/storno/[token]",
    ]);

    const initialMatomoCalls = await getMatomoCalls(page);
    expect(initialMatomoCalls.some((call) => call[0] === "trackPageView")).toBe(false);
    expect(initialMatomoCalls.some((call) => call.some((value) => value.includes(fixture.cancelToken ?? "")))).toBe(false);

    await page.getByRole("button", { name: "Potvrdit storno" }).click();

    await expect(page.getByRole("heading", { name: new RegExp(`Hotovo, ${fixture.clientName}`) })).toBeVisible();

    await expect.poll(async () => getMatomoCalls(page)).toEqual(
      expect.arrayContaining([
        ["trackEvent", "Rezervace", "Storno odesláno", fixture.serviceName],
        ["trackEvent", "Rezervace", "Storno dokončeno", fixture.serviceName],
      ]),
    );

    const finalMatomoCalls = await getMatomoCalls(page);
    expect(finalMatomoCalls.some((call) => call.some((value) => value.includes(fixture.cancelToken ?? "")))).toBe(false);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: {
        id: fixture.bookingId,
      },
      include: {
        statusHistory: true,
      },
    });

    expect(booking.status).toBe(BookingStatus.CANCELLED);
    expect(booking.cancelledAt).toBeTruthy();
    expect(booking.statusHistory.some((item) => item.status === BookingStatus.CANCELLED)).toBe(true);
  });

  test("klient přesune rezervaci pomocí veřejného tokenu", async ({ page }) => {
    test.setTimeout(60_000);

    const fixture = await createManagedBookingFixture();
    fixtures.push(fixture);

    await page.goto(`/rezervace/sprava/${fixture.manageToken}`);
    await expect(page.getByRole("heading", { name: "Změna termínu rezervace" })).toBeVisible();

    const managedBooking = await prisma.booking.findUniqueOrThrow({
      where: {
        id: fixture.bookingId,
      },
      select: {
        serviceId: true,
        serviceDurationMinutes: true,
        servicePriceFromCzk: true,
      },
    });

    const successHeading = page.getByRole("heading", { name: "Rezervace byla úspěšně přesunuta." });
    const confirmButton = page.getByRole("button", { name: "Potvrdit nový termín" });
    const conflictMessage = page
      .getByText(/(nový termín|vybraný (termín|slot)).*(koliduje|není k dispozici)/i)
      .first();
    const conflictingSelection = await selectAvailableSlot(page, confirmButton);
    const selectedSlotId = conflictingSelection.slotId;
    const selectedStartIso = conflictingSelection.startsAt;
    const selectedStart = new Date(selectedStartIso);
    const selectedEnd = new Date(selectedStart.getTime() + managedBooking.serviceDurationMinutes * 60 * 1000);

    const conflictClient = await prisma.client.create({
      data: {
        fullName: `E2E Runtime Kolize ${fixture.runId}`,
        email: `${fixture.runId}-runtime-conflict@example.test`,
        phone: "+420777000002",
        lastBookedAt: selectedStart,
      },
    });

    const runtimeConflictBooking = await prisma.booking.create({
      data: {
        clientId: conflictClient.id,
        slotId: selectedSlotId,
        serviceId: managedBooking.serviceId,
        source: BookingSource.WEB,
        status: BookingStatus.CONFIRMED,
        clientNameSnapshot: conflictClient.fullName,
        clientEmailSnapshot: conflictClient.email ?? `${fixture.runId}-runtime-conflict@example.test`,
        clientPhoneSnapshot: conflictClient.phone,
        serviceNameSnapshot: fixture.serviceName,
        serviceDurationMinutes: managedBooking.serviceDurationMinutes,
        servicePriceFromCzk: managedBooking.servicePriceFromCzk,
        scheduledStartsAt: selectedStart,
        scheduledEndsAt: selectedEnd,
        confirmedAt: new Date(),
        statusHistory: {
          create: {
            status: BookingStatus.CONFIRMED,
            actorType: BookingActorType.SYSTEM,
            note: "E2E runtime conflict booking",
          },
        },
      },
    });

    await confirmButton.click();
    await expect(conflictMessage).toBeVisible();
    await prisma.booking.update({
      where: {
        id: runtimeConflictBooking.id,
      },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });

    const successSelection = await selectAvailableSlot(
      page,
      confirmButton,
      new Set([conflictingSelection.selectionKey]),
    );
    await expectSelectedRescheduleSlot(page, {
      slotId: successSelection.slotId,
      startsAt: successSelection.startsAt,
    });
    expect(successSelection.startsAt).not.toBe(selectedStartIso);
    expect(successSelection.selectionKey).not.toBe(conflictingSelection.selectionKey);
    await confirmButton.click();
    const attemptedSlotIds = new Set([selectedSlotId, successSelection.slotId]);
    try {
      await expect(successHeading).toBeVisible({ timeout: 30_000 });
    } catch {
      await submitRescheduleUntilSuccess(
        page,
        confirmButton,
        successHeading,
        conflictMessage,
        attemptedSlotIds,
      );
    }

    try {
      await expect(successHeading).toBeVisible({ timeout: 30_000 });
    } catch (error) {
      const formError = (await page.locator("text=Změnu termínu se teď nepodařilo uložit. Zkuste to prosím znovu.").count()) > 0
        ? "Změnu termínu se teď nepodařilo uložit. Zkuste to prosím znovu."
        : (await page.locator("text=Vyberte prosím nový termín a potvrďte změnu.").count()) > 0
          ? "Vyberte prosím nový termín a potvrďte změnu."
          : (await conflictMessage.count()) > 0
            ? await conflictMessage.first().innerText()
            : "Neznámý stav formuláře bez success headingu.";
      throw new Error(`Reschedule success heading se neukázal. Poslední stav formuláře: ${formError}`, {
        cause: error,
      });
    }

    const booking = await prisma.booking.findUniqueOrThrow({
      where: {
        id: fixture.bookingId,
      },
      include: {
        rescheduleLogs: true,
      },
    });

    expect(booking.rescheduleCount).toBe(1);
    expect(booking.rescheduledAt).toBeTruthy();
    expect(booking.rescheduleLogs.some((item) => item.changedByClient)).toBe(true);
  });

  test("owner otevře manuální rezervaci z detailu klienta a vytvoří rezervaci pro předvyplněného klienta", async ({ page }) => {
    const fixture = await createManagedBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.OWNER);
    fixtures.push(fixture);

    await loginAdmin(page, admin.email, admin.password);

    await page.goto(`/admin/klienti/${fixture.clientId!}`);
    const createBookingLink = page.getByRole("link", { name: "Vytvořit rezervaci" }).first();
    await expect(createBookingLink).toHaveAttribute(
      "href",
      `/admin/rezervace?create=1&clientId=${fixture.clientId!}`,
    );

    await createBookingLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/rezervace\\?create=1&clientId=${fixture.clientId!}`),
    );
    await expect(page.getByRole("heading", { name: "Nová rezervace" })).toBeVisible();
    await expect(page.getByText("Vybraná klientka")).toBeVisible();
    await expect(selectedClientCard(page).getByText(fixture.clientName)).toBeVisible();
    await expect(selectedClientCard(page).getByText(fixture.clientEmail)).toBeVisible();

    await page.getByLabel("Služba").selectOption({ label: fixture.serviceName });
    const createButton = page.getByRole("button", { name: "Vytvořit rezervaci" }).last();
    await selectSlotById(
      page,
      fixture.slotLabels.rescheduleConflictButtonLabel,
      fixture.slotLabels.rescheduleConflictSlotId,
      createButton,
    );
    await expect(page.locator('input[name="startsAt"]')).toHaveValue(fixture.slotLabels.rescheduleStartAt);
    await page.getByRole("button", { name: "Vytvořit rezervaci" }).last().click();
    await expect.poll(async () => prisma.booking.count({
      where: {
        clientId: fixture.clientId!,
        source: BookingSource.PHONE,
        scheduledStartsAt: new Date(fixture.slotLabels.rescheduleStartAt),
      },
    })).toBe(1);

    const booking = await prisma.booking.findFirstOrThrow({
      where: {
        clientId: fixture.clientId!,
        source: BookingSource.PHONE,
        scheduledStartsAt: new Date(fixture.slotLabels.rescheduleStartAt),
      },
    });

    expect(booking.status).toBe(BookingStatus.CONFIRMED);
  });

  test("salon sees manual booking action on client detail and gets the same prefilled flow", async ({ page }) => {
    const fixture = await createManagedBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.SALON);
    fixtures.push(fixture);

    await loginAdmin(page, admin.email, admin.password);

    await page.goto(`/admin/provoz/klienti/${fixture.clientId!}`);
    const createBookingLink = page.getByRole("link", { name: "Vytvořit rezervaci" }).first();
    await expect(createBookingLink).toHaveAttribute(
      "href",
      `/admin/provoz/rezervace?create=1&clientId=${fixture.clientId!}`,
    );

    await createBookingLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/provoz/rezervace\\?create=1&clientId=${fixture.clientId!}`),
    );
    await expect(page.getByRole("heading", { name: "Nová rezervace" })).toBeVisible();
    await expect(page.getByText("Vybraná klientka")).toBeVisible();
    await expect(selectedClientCard(page).getByText(fixture.clientName)).toBeVisible();
    await expect(page.locator('input[name="selectedClientId"]')).toHaveValue(fixture.clientId!);
  });

  test("manual booking drawer stays usable without or with invalid clientId prefill", async ({ page }) => {
    const fixture = await createManagedBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.OWNER);
    fixtures.push(fixture);

    await loginAdmin(page, admin.email, admin.password);

    await page.goto("/admin/rezervace");
    await expect(page.getByRole("heading", { name: "Nová rezervace" })).toHaveCount(0);
    const createBookingTrigger = page.getByRole("button", { name: "Přidat rezervaci" }).first();
    await createBookingTrigger.click();
    const bookingDrawer = page.getByRole("dialog", { name: "Nová rezervace" });
    await expect(bookingDrawer).toBeVisible();
    await expect(bookingDrawer.getByText("Vybraná klientka")).toHaveCount(0);
    await bookingDrawer.getByRole("button", { name: "Zrušit" }).click();
    await expect(bookingDrawer).toHaveCount(0);
    await expect(createBookingTrigger).toBeFocused();

    await page.goto("/admin/rezervace?create=1&clientId=missing-client");
    await expect(page.getByRole("heading", { name: "Nová rezervace" })).toBeVisible();
    await expect(page.getByText("Klientku se nepodařilo předvyplnit.")).toBeVisible();
    await expect(page.getByText("Vybraná klientka")).toHaveCount(0);
  });

  test("manual booking prefill warns when the selected client is inactive", async ({ page }) => {
    const fixture = await createManagedBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.OWNER);
    fixtures.push(fixture);

    await prisma.client.update({
      where: {
        id: fixture.clientId!,
      },
      data: {
        isActive: false,
      },
    });

    await loginAdmin(page, admin.email, admin.password);

    await page.goto(`/admin/rezervace?create=1&clientId=${fixture.clientId!}`);
    await expect(page.getByText("Klientka je neaktivní.")).toBeVisible();
    await expect(selectedClientCard(page).getByText(fixture.clientName)).toBeVisible();
  });

  test("manual booking keeps overlap validation active for prefilled clients", async ({ page }) => {
    const fixture = await createManagedBookingFixture();
    const admin = await createAdminFixture(fixture.runId, AdminRole.OWNER);
    fixtures.push(fixture);

    await loginAdmin(page, admin.email, admin.password);

    await page.goto(`/admin/rezervace?create=1&clientId=${fixture.clientId!}`);
    const bookingDrawer = page.getByRole("dialog", { name: "Nová rezervace" });
    await bookingDrawer.getByLabel("Služba").selectOption({ label: fixture.serviceName });
    await safeClick(page, bookingDrawer.getByRole("button", { name: "Ruční zadání" }));
    await expect(bookingDrawer.getByLabel("Datum")).toBeVisible();
    await bookingDrawer.getByLabel("Datum").fill(fixture.slotLabels.primaryDateKey);
    await bookingDrawer.getByLabel("Čas od").fill(fixture.slotLabels.primaryTime);
    await bookingDrawer.getByRole("button", { name: "Vytvořit rezervaci" }).click();

    await expect(
      page.getByText(
        /(koliduje|není (k dispozici|dostupný)|obsazen|rezervovaný|zasahuje do interně blokovaného času)/i,
      ).first(),
    ).toBeVisible();
  });

  test("guest cannot access admin manual booking flow", async ({ page }) => {
    await page.goto("/admin/rezervace?create=1&clientId=missing-client");
    await expect(page).toHaveURL(/\/admin\/prihlaseni/);
  });

  test("owner se přihlásí a potvrdí čekající rezervaci", async ({ page }) => {
    const fixture = await createManagedBookingFixture(BookingStatus.PENDING);
    const admin = await createAdminFixture(fixture.runId);
    fixtures.push(fixture);

    await loginAdmin(page, admin.email, admin.password);

    await page.goto(`/admin/rezervace/${fixture.bookingId}`);
    const bookingActions = page.locator("#booking-actions");
    await bookingActions.getByRole("button", { name: "Potvrdit rezervaci" }).first().click();
    await bookingActions.getByLabel("Volitelný důvod").fill("E2E potvrzení");
    await bookingActions.locator("button[type='submit']").click();

    await expect.poll(async () => prisma.booking.findUnique({
      where: {
        id: fixture.bookingId,
      },
      select: {
        status: true,
        confirmedAt: true,
      },
    })).toMatchObject({
      status: BookingStatus.CONFIRMED,
      confirmedAt: expect.any(Date),
    });

    await expect(
      page.getByText("Potvrzený termín · Po návštěvě zapiš úhradu a dokonči návštěvu."),
    ).toBeVisible({ timeout: 30_000 });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: {
        id: fixture.bookingId,
      },
      include: {
        statusHistory: true,
      },
    });

    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.confirmedAt).toBeTruthy();
    expect(booking.statusHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: "E2E potvrzení",
        status: BookingStatus.CONFIRMED,
      }),
    ]));
  });
});
