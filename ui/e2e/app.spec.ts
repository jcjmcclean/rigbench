import { expect, test } from "@playwright/test";
import { editedMarker, openApp, presetTrigger, slot } from "./helpers.ts";

test.describe("startup", () => {
  test("loads past the splash into the rig, with the mock-engine badge", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApp(page);
    await expect(page).toHaveTitle(/.+/);
    await expect(page.getByRole("banner")).toContainText("Universal Audio Apollo");
    await expect(page.getByRole("banner")).toContainText("48.0 kHz");
    await expect(page.getByRole("banner")).toContainText("7.4 ms · low");
    await expect(presetTrigger(page)).toContainText("Hiwatt Lead");
    await expect(editedMarker(page)).toHaveCount(0);
    await expect(slot(page, "VST3").getByRole("button", { name: /Load a plugin/ })).toBeVisible();
    await expect(slot(page, "NAM")).toContainText("Fig HW C50 MG 412");
    await expect(slot(page, "IR")).toContainText("Mesa 4x12 — SM57");
    await expect(page.getByText("Preview — mock engine")).toBeVisible();
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
    const live = page.getByRole("button", { name: /^Live$/ });
    await live.click();
    const muted = page.getByRole("button", { name: /^Muted$/ });
    await expect(muted).toBeVisible();
    await expect(page.locator(".terminal--in .meter__seg.is-on")).toHaveCount(0);
    await muted.click();
    await expect(page.getByRole("button", { name: /^Live$/ })).toBeVisible();
  });

  test("audio settings button is present (native-only in the mock)", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Audio settings" }).click();
    await expect(page.getByRole("main")).toBeVisible();
  });
});
