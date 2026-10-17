import { expect, test } from "@playwright/test";
import { editedMarker, openApp, presetTrigger, slot } from "./helpers.ts";

test.describe("startup", () => {
  test("loads past the splash into the rig, with the preview badge", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApp(page);
    await expect(page).toHaveTitle(/.+/);
    await expect(page.getByRole("banner")).toContainText("Universal Audio Apollo");
    await expect(page.getByRole("banner")).toContainText("48 kHz");
    await expect(page.getByRole("banner")).toContainText("7.4 ms · low");
    await expect(presetTrigger(page)).toContainText("Hiwatt Lead");
    await expect(editedMarker(page)).toHaveCount(0);
    await expect(slot(page, "VST3").getByRole("button", { name: /Load a plugin/ })).toBeVisible();
    await expect(slot(page, "NAM")).toContainText("Fig HW C50 MG 412");
    await expect(slot(page, "IR")).toContainText("Mesa 4x12 SM57");
    await expect(page.getByText("Preview: no sound")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText(
      "Drag a knob, or use the arrow keys or scroll wheel. Hold Shift for finer control.",
    );
    await expect(page.getByRole("contentinfo")).toContainText(/v\d+\.\d+\.\d+/);
    expect(errors).toEqual([]);
  });

  test("the meters move while monitoring", async ({ page }) => {
    await openApp(page);
    const lit = page.locator(".terminal--in .meter__seg.is-on");
    await expect.poll(() => lit.count(), { timeout: 5000 }).toBeGreaterThan(0);
  });

  test("the scope canvas is laid out and drawn", async ({ page }) => {
    await openApp(page);
    const canvas = page.locator("canvas.scope");
    await expect(canvas).toBeAttached();
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0);
  });
});

test.describe("monitoring", () => {
  test("LIVE toggles to Muted (meters go quiet) and back", async ({ page }) => {
    await openApp(page);
    // One toggle with a fixed name; pressed while you can hear your guitar.
    const transport = page.getByRole("button", { name: "Hear your guitar" });
    await expect(transport).toHaveText("Live");
    await expect(transport).toHaveAttribute("aria-pressed", "true");
    await transport.click();
    await expect(transport).toHaveText("Muted");
    await expect(transport).toHaveAttribute("aria-pressed", "false");
    await expect(transport).toHaveAttribute("title", "Muted: click to hear your guitar");
    await expect(page.locator(".terminal--in .meter__seg.is-on")).toHaveCount(0);
    await transport.click();
    await expect(transport).toHaveText("Live");
    await expect(transport).toHaveAttribute("aria-pressed", "true");
  });

  test("the gear button opens the Settings screen, and Done closes it", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("status")).toContainText("Running at 48 kHz");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("main")).toBeVisible();
  });
});
