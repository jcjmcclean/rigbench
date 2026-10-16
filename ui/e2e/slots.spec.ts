import { expect, test } from "@playwright/test";
import { editedMarker, openApp, slot } from "./helpers.ts";

test.describe("signal chain slots", () => {
  test("bypass toggles ON -> BYPASS -> ON", async ({ page }) => {
    await openApp(page);
    const nam = slot(page, "NAM");
    await nam.getByRole("button", { name: "ON" }).click();
    const bypass = nam.getByRole("button", { name: "BYPASS" });
    await expect(bypass).toHaveAttribute("aria-pressed", "true");
    await expect(nam).toHaveClass(/is-bypassed/);
    await expect(editedMarker(page)).toBeVisible();
    await bypass.click();
    await expect(nam.getByRole("button", { name: "ON" })).toHaveAttribute("aria-pressed", "false");
    await expect(editedMarker(page)).toHaveCount(0);
  });

  test("Change cycles the amp model name", async ({ page }) => {
    await openApp(page);
    const nam = slot(page, "NAM");
    const name = nam.locator(".module__name");
    await expect(name).toHaveText("Fig HW C50 MG 412");
    await nam.getByRole("button", { name: "Change" }).click();
    await expect(name).toHaveText("Fig HW DR Hot 212");
    await nam.getByRole("button", { name: "Change" }).click();
    await expect(name).toHaveText("Fig HW C50 MG DI");
    await nam.getByRole("button", { name: "Change" }).click();
    await expect(name).toHaveText("Fig HW C50 MG 412");
  });

  test("Change cycles the cab IR name", async ({ page }) => {
    await openApp(page);
    const ir = slot(page, "IR");
    await ir.getByRole("button", { name: "Change" }).click();
    await expect(ir.locator(".module__name")).toHaveText("Hiwatt SE4123 — R121");
  });

  test("clearing a slot shows the empty load state; loading fills it again", async ({ page }) => {
    await openApp(page);
    const ir = slot(page, "IR");
    await ir.getByTitle("Remove").click();
    const load = ir.getByRole("button", { name: /Load a cab IR/ });
    await expect(load).toBeVisible();
    await expect(ir).toHaveClass(/is-empty/);
    await expect(ir.getByRole("slider")).toHaveCount(0);
    await expect(ir.getByRole("button", { name: /ON|BYPASS/ })).toHaveCount(0);
    await load.click();
    await expect(ir.locator(".module__name")).toHaveText("Hiwatt SE4123 — R121");
    await expect(ir.getByRole("slider", { name: "Mix" })).toHaveAttribute("aria-valuetext", "100%");
    await expect(ir).toHaveClass(/is-loaded/);
  });

  test("the empty VST3 slot loads a plugin that offers its editor", async ({ page }) => {
    await openApp(page);
    const vst = slot(page, "VST3");
    await vst.getByRole("button", { name: /Load a plugin/ }).click();
    await expect(vst.locator(".module__name")).toHaveText("SICO High Gain");
    await expect(vst.getByRole("button", { name: /Open editor/ })).toBeVisible();
    await expect(vst.getByRole("slider")).toHaveCount(0);
  });

  test("the ✕ is clickable with the mouse on every loaded slot (not covered by the name)", async ({ page }) => {
    await openApp(page);
    await slot(page, "VST3").getByRole("button", { name: /Load a plugin/ }).click();
    for (const [kind, empty] of [["VST3", /Load a plugin/], ["NAM", /Load an amp model/], ["IR", /Load a cab IR/]] as const) {
      const unit = slot(page, kind);
      await unit.hover();
      const remove = unit.getByTitle("Remove");
      await expect(remove).toBeVisible();
      // trial: Playwright's actionability check fails if another element would get the click
      await remove.click({ trial: true, timeout: 2000 });
      await remove.click();
      await expect(unit.getByRole("button", { name: empty })).toBeVisible();
    }
  });
});
