import { expect, test } from "@playwright/test";
import { knob, openApp } from "./helpers.ts";

test.describe("tuner and gate", () => {
  test("the tuner opens from the top bar, shows a note, and closes", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Tuner" }).click();
    const tuner = page.getByRole("dialog", { name: "Tuner" });
    await expect(tuner).toBeVisible();
    // The mock engine plays a low E that settles into tune.
    await expect(tuner.locator(".tuner__note")).toHaveText("E2", { timeout: 5000 });
    await expect(tuner.locator(".tuner__advice")).toHaveText(/In tune|cents (flat|sharp)/);
    // One hidden status line speaks for the readout, coarsely.
    await expect(tuner.getByRole("status")).toHaveText(/^(E 2|In tune|E 2, in tune)$/);
    await page.keyboard.press("Escape");
    await expect(tuner).toHaveCount(0);
  });

  test("the input gate starts off and turns on with the keyboard", async ({ page }) => {
    await openApp(page);
    const gate = knob(page, "Gate");
    await expect(gate).toHaveAttribute("aria-valuetext", "Off");
    await gate.focus();
    await page.keyboard.press("ArrowUp");
    await expect(gate).toHaveAttribute("aria-valuetext", "-77 dB");
  });
});
