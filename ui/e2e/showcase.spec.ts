import { expect, test } from "@playwright/test";
import { knob } from "./helpers.ts";

// showcase.html: the website's embedded live previews (same app + mock engine).
test("website preview: full rig, and the wheel scrolls the page instead of turning knobs", async ({ page }) => {
  await page.goto("/showcase.html");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("article.module--vst3 .module__name")).toHaveText("SICO High Gain");
  const gain = knob(page, "Gain");
  await expect(gain).toHaveAttribute("aria-valuetext", "80");
  const box = (await gain.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  await expect(gain).toHaveAttribute("aria-valuetext", "80");
});

test("website preview: the status-bar hint doesn't mention the scroll wheel", async ({ page }) => {
  await page.goto("/showcase.html");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("Drag a knob, or use the arrow keys. Hold Shift for finer control.");
  await expect(footer).not.toContainText("wheel");
  await expect(footer).toContainText("Preview: no sound");
});
