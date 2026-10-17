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

// What showcase.tsx gives the site in ?view=tuner.
type MicWindow = Window & { rigbenchMic: { start(): Promise<void>; stop(): void } };

test.describe("website preview: the tuner (?view=tuner)", () => {
  // Real Web Audio, with a stand-in microphone: an oscillator playing the A string.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.frequency.value = 110;
        const out = ctx.createMediaStreamDestination();
        osc.connect(out);
        osc.start();
        return out.stream;
      };
    });
  });

  test("opens on the tuner and stays open", async ({ page }) => {
    await page.goto("/showcase.html?view=tuner");
    const tuner = page.getByRole("dialog", { name: "Tuner" });
    await expect(tuner.locator(".tuner__note")).toHaveText("E2", { timeout: 5000 });
    await tuner.getByRole("button", { name: "Done" }).click();
    await expect(tuner.locator(".tuner__note")).toBeVisible();
  });

  test("listens to the microphone while the page asks it to, then goes back to the pretend E", async ({ page }) => {
    await page.goto("/showcase.html?view=tuner");
    const note = page.getByRole("dialog", { name: "Tuner" }).locator(".tuner__note");
    await expect(note).toHaveText("E2", { timeout: 5000 });

    // Browsers only start audio after a click; on the site that's the button.
    await page.getByRole("dialog", { name: "Tuner" }).click({ position: { x: 10, y: 10 } });
    await page.evaluate(() => (window as unknown as MicWindow).rigbenchMic.start());
    await expect(note).toHaveText("A2", { timeout: 5000 });
    await expect(page.locator(".tuner")).toHaveClass(/is-in-tune/);

    await page.evaluate(() => (window as unknown as MicWindow).rigbenchMic.stop());
    await expect(note).toHaveText("E2", { timeout: 5000 });
  });
});
