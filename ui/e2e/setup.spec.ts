import { expect, test, type Page } from "@playwright/test";
import { openApp, slot } from "./helpers.ts";

// First-run setup, the Settings screen and the empty-slot download links,
// against the mock engine's pretend devices ("MacBook Pro Microphone" and a
// "Scarlett 2i2 USB" with the guitar on Input 2). `/?setup` starts the mock as
// a fresh install.

function wizard(page: Page) {
  return page.getByRole("dialog").filter({ has: page.locator(".setup__card") });
}

async function openFreshInstall(page: Page) {
  await page.goto("/?setup");
  await expect(page, "is this Tonebench's dev server? (see E2E_PORT in playwright.config.ts)").toHaveTitle("Tonebench");
  await expect(page.getByRole("heading", { name: "What’s your guitar plugged into?" })).toBeVisible();
}

function telem(page: Page, label: string) {
  return page.locator(".telem").filter({ has: page.locator(".telem__label", { hasText: label }) }).locator(".telem__value");
}

test.describe("first-run setup", () => {
  test("pick the interface, find the guitar, pick the output, start playing; then Settings", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openFreshInstall(page);

    // Step 1: starts on the laptop mic, with a feedback warning.
    await expect(page.getByLabel("Step 1 of 3")).toBeVisible();
    await expect(page.getByText(/computer’s own microphone/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Muted$/ })).toBeVisible();
    await page.getByRole("radio", { name: "Scarlett 2i2 USB" }).click();
    await expect(page.getByRole("radio", { name: "Scarlett 2i2 USB" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/computer’s own microphone/)).toHaveCount(0);
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2: play a few notes; the mock strums on Input 2.
    await expect(page.getByRole("heading", { name: "Play a few notes" })).toBeVisible();
    await expect(page.getByText("Found your guitar on Input 2.")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("radio", { name: "Input 2" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/Good level|Quite quiet|Too loud/)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3: output and test sound.
    await expect(page.getByRole("heading", { name: "Where do you want to hear it?" })).toBeVisible();
    const outputs = page.getByRole("radiogroup", { name: "Output" });
    await outputs.getByRole("radio", { name: "MacBook Pro Speakers" }).click();
    await expect(outputs.getByRole("radio", { name: "MacBook Pro Speakers" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Play test sound" }).click();
    await page.getByRole("button", { name: "Start playing" }).click();

    // Done: the wizard is gone and monitoring is on.
    await expect(wizard(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Live$/ })).toBeVisible();
    await expect(telem(page, "Device")).toHaveText("Scarlett 2i2 USB");

    // Settings remembers the input the wizard found.
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    const input = settings.getByLabel("Guitar is plugged into");
    await expect(input).toHaveValue("1");
    await expect(input.locator("option:checked")).toHaveText("Input 2");
    await expect(settings.getByLabel("You hear it through")).toHaveValue("MacBook Pro Speakers");

    // Responsiveness 256 → the top bar's buffer follows.
    await expect(telem(page, "Buffer")).toHaveText("128");
    await settings.getByLabel("Responsiveness").selectOption("256");
    await expect(telem(page, "Buffer")).toHaveText("256");
    await expect(settings.getByLabel("Responsiveness")).toHaveValue("256");

    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Skip setup goes straight to playing", async ({ page }) => {
    await openFreshInstall(page);
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(wizard(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Live$/ })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("Back returns to the previous step", async ({ page }) => {
    await openFreshInstall(page);
    await page.getByRole("radio", { name: "Scarlett 2i2 USB" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Play a few notes" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "What’s your guitar plugged into?" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Scarlett 2i2 USB" })).toHaveAttribute("aria-checked", "true");
  });

  test("a normal start (no ?setup) shows no wizard", async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole("heading", { name: "What’s your guitar plugged into?" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Live$/ })).toBeVisible();
  });

  test("Settings → Run setup again shows the wizard; skipping returns to the app", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Run setup again" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What’s your guitar plugged into?" })).toBeVisible();
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(wizard(page)).toHaveCount(0);
  });
});

test.describe("empty-slot download links", () => {
  test("clearing the amp slot offers TONE3000, which opens in a new window", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __opened: unknown[][] };
      w.__opened = [];
      window.open = (...args: unknown[]) => { w.__opened.push(args); return null; };
    });
    await openApp(page);
    const nam = slot(page, "NAM");
    await expect(nam.getByText("Don’t have one?")).toHaveCount(0);
    await nam.hover();
    await nam.getByTitle("Remove").click();
    await expect(nam.getByText("Don’t have one?")).toBeVisible();
    const link = nam.getByRole("button", { name: "Free amp models on TONE3000" });
    await expect(link).toBeVisible();
    await link.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened))
      .toEqual([["https://www.tone3000.com/search?format=nam", "_blank", "noopener"]]);
    // Opening a link doesn't load anything into the slot.
    await expect(nam).toHaveClass(/is-empty/);
  });
});
