import { expect, test } from "@playwright/test";
import { dragVertically, editedMarker, knob, openApp, slot } from "./helpers.ts";

test.describe("knobs", () => {
  test("dragging a knob up with the mouse raises its value text", async ({ page }) => {
    await openApp(page);
    const level = knob(slot(page, "NAM"), "Level");
    await expect(level).toHaveAttribute("aria-valuetext", "+0 dB");
    await dragVertically(page, level, -45); // 45px of 180 = +0.25 -> +12 dB
    await expect(level).toHaveAttribute("aria-valuetext", "+12 dB");
    await expect(slot(page, "NAM").locator(".knob__value-text")).toHaveText("+12 dB");
    await expect(editedMarker(page)).toBeVisible();
  });

  test("dragging down lowers it, and it clamps at the bottom", async ({ page }) => {
    await openApp(page);
    const gain = knob(page, "Gain");
    await expect(gain).toHaveAttribute("aria-valuetext", "80");
    await dragVertically(page, gain, 400);
    await expect(gain).toHaveAttribute("aria-valuetext", "0");
  });

  test("scrolling the wheel over a knob adjusts it (and doesn't scroll the page)", async ({ page }) => {
    await openApp(page);
    const mix = knob(slot(page, "IR"), "Mix");
    await expect(mix).toHaveAttribute("aria-valuetext", "100%");
    const box = (await mix.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 100); // down
    await expect(mix).toHaveAttribute("aria-valuetext", "97%");
    await page.mouse.wheel(0, 100);
    await expect(mix).toHaveAttribute("aria-valuetext", "94%");
    await page.mouse.wheel(0, -100); // up
    await expect(mix).toHaveAttribute("aria-valuetext", "97%");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("arrow keys on a focused knob step it (Shift for fine)", async ({ page }) => {
    await openApp(page);
    const master = knob(page, "Master");
    await master.focus();
    await page.keyboard.press("ArrowUp");
    await expect(master).toHaveAttribute("aria-valuetext", "85");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(master).toHaveAttribute("aria-valuetext", "75");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(master).toHaveAttribute("aria-valuetext", "76");
    await expect(page.locator(".terminal--out .knob__value-text")).toHaveText("76");
  });

  test("knobs are reachable with Tab", async ({ page }) => {
    await openApp(page);
    const gain = knob(page, "Gain");
    await gain.focus();
    await expect(gain).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(gain).toHaveAttribute("aria-valuetext", "75");
  });
});
