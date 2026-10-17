import { expect, test, type Page } from "@playwright/test";
import { editedMarker, knob, openApp, presetTrigger } from "./helpers.ts";

const listbox = (page: Page) => page.getByRole("listbox", { name: "Presets" });
// A preset by its exact name (the Rename/Delete items contain the active name too).
const preset = (page: Page, name: string) => page.getByRole("option", { name, exact: true });

async function makeAnEdit(page: Page) {
  await knob(page, "Master").focus();
  await page.keyboard.press("ArrowDown");
  await expect(editedMarker(page)).toBeVisible();
}

test.describe("preset menu", () => {
  test("opens, lists presets with the active one selected, and closes", async ({ page }) => {
    await openApp(page);
    await presetTrigger(page).click();
    await expect(listbox(page)).toBeVisible();
    await expect(listbox(page).getByRole("option")).toHaveText([
      "Gilmour Clean", "Page Crunch", "Hiwatt Lead", "Bedroom Low-Volume", "+ Save current rig…",
      "Rename “Hiwatt Lead”…", "Delete “Hiwatt Lead”…",
    ]);
    await expect(preset(page, "Hiwatt Lead")).toHaveAttribute("aria-selected", "true");
    await expect(preset(page, "Hiwatt Lead")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(listbox(page)).toHaveCount(0);
    await expect(presetTrigger(page)).toBeFocused();
  });

  test("clicking outside closes it", async ({ page }) => {
    await openApp(page);
    await presetTrigger(page).click();
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    await expect(listbox(page)).toHaveCount(0);
  });

  test("picking a preset loads it", async ({ page }) => {
    await openApp(page);
    await presetTrigger(page).click();
    await page.getByRole("option", { name: "Page Crunch" }).click();
    await expect(listbox(page)).toHaveCount(0);
    await expect(presetTrigger(page)).toContainText("Page Crunch");
  });

  test("keyboard: arrows move, Enter picks", async ({ page }) => {
    await openApp(page);
    await presetTrigger(page).click();
    await page.keyboard.press("ArrowDown"); // Hiwatt Lead -> Bedroom Low-Volume
    await expect(page.getByRole("option", { name: "Bedroom Low-Volume" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("option", { name: "Gilmour Clean" })).toBeFocused();
    await page.keyboard.press("ArrowUp"); // wraps to the last action
    await expect(page.getByRole("option", { name: "Delete “Hiwatt Lead”…" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(presetTrigger(page)).toContainText("Gilmour Clean");
  });

  test("'edited' appears after a change and clears when another preset is loaded", async ({ page }) => {
    await openApp(page);
    await expect(editedMarker(page)).toHaveCount(0);
    await makeAnEdit(page);
    await presetTrigger(page).click();
    await page.getByRole("option", { name: "Gilmour Clean" }).click();
    await expect(presetTrigger(page)).toContainText("Gilmour Clean");
    await expect(editedMarker(page)).toHaveCount(0);
  });

  test("save a new preset via the modal: it becomes active, clean, and is listed", async ({ page }) => {
    await openApp(page);
    await makeAnEdit(page);
    await presetTrigger(page).click();
    await page.getByRole("option", { name: "Save current rig…" }).click();
    const dialog = page.getByRole("dialog", { name: "Save current rig" });
    await expect(dialog).toBeVisible();
    const field = dialog.getByRole("textbox", { name: "Preset name" });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Hiwatt Lead copy");
    await field.fill("Late Night Lead");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(presetTrigger(page)).toContainText("Late Night Lead");
    await expect(editedMarker(page)).toHaveCount(0);
    await presetTrigger(page).click();
    await expect(preset(page, "Late Night Lead")).toHaveAttribute("aria-selected", "true");
    await expect(listbox(page).getByRole("option")).toHaveCount(8);   // 5 presets + save, rename, delete
  });

  test("save dialog: Enter saves; empty names are rejected", async ({ page }) => {
    await openApp(page);
    await presetTrigger(page).click();
    await page.getByRole("option", { name: "Save current rig…" }).click();
    const dialog = page.getByRole("dialog");
    const field = dialog.getByRole("textbox", { name: "Preset name" });
    const save = dialog.getByRole("button", { name: "Save" });
    await field.fill("   ");
    await expect(save).toBeDisabled();
    await field.press("Enter");
    await expect(dialog).toBeVisible();
    await field.fill("Keyboard Save");
    await field.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(presetTrigger(page)).toContainText("Keyboard Save");
  });

  test("save dialog: Escape and the backdrop cancel without saving", async ({ page }) => {
    await openApp(page);
    const openSave = async () => {
      await presetTrigger(page).click();
      await page.getByRole("option", { name: "Save current rig…" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    };
    await openSave();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openSave();
    await page.mouse.click(5, 5); // backdrop
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(presetTrigger(page)).toContainText("Hiwatt Lead");
    await presetTrigger(page).click();
    await expect(listbox(page).getByRole("option")).toHaveCount(7);   // nothing was added
  });

  test("saving over the active preset clears 'edited' without duplicating it", async ({ page }) => {
    await openApp(page);
    await makeAnEdit(page);
    await presetTrigger(page).click();
    await page.getByRole("option", { name: "Save current rig…" }).click();
    const field = page.getByRole("dialog").getByRole("textbox", { name: "Preset name" });
    await field.fill("Hiwatt Lead");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Replace" })).toBeVisible();
    await field.press("Enter");
    await expect(editedMarker(page)).toHaveCount(0);
    await presetTrigger(page).click();
    await expect(preset(page, "Hiwatt Lead")).toHaveCount(1);
  });

  test("save dialog keeps focus where the user tabs while the meters stream", async ({ page }) => {
    await openApp(page);
    await presetTrigger(page).click();
    await page.getByRole("option", { name: "Save current rig…" }).click();
    const dialog = page.getByRole("dialog");
    await page.keyboard.press("Tab");
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeFocused();
    await page.waitForTimeout(400); // ~8 meter ticks re-render the app
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Enter"); // must Cancel, not save "Hiwatt Lead copy"
    await expect(dialog).toHaveCount(0);
    await presetTrigger(page).click();
    await expect(page.getByRole("option", { name: "Hiwatt Lead copy" })).toHaveCount(0);
  });

  test("save dialog traps Tab focus inside", async ({ page }) => {
    await openApp(page);
    await presetTrigger(page).click();
    await page.getByRole("option", { name: "Save current rig…" }).click();
    const dialog = page.getByRole("dialog");
    const field = dialog.getByRole("textbox", { name: "Preset name" });
    await expect(field).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(field).toBeFocused();
  });
});

test.describe("rename and delete", () => {
  test("rename the active preset, then delete it", async ({ page }) => {
    await openApp(page);
    await presetTrigger(page).click();
    await page.getByRole("option", { name: "Rename “Hiwatt Lead”…" }).click();
    const field = page.getByRole("textbox", { name: "New name" });
    await field.fill("Big Lead");
    await field.press("Enter");
    await expect(presetTrigger(page)).toContainText("Big Lead");

    await presetTrigger(page).click();
    await expect(preset(page, "Hiwatt Lead")).toHaveCount(0);
    await page.getByRole("option", { name: "Delete “Big Lead”…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(presetTrigger(page)).toContainText("No preset");
    await presetTrigger(page).click();
    await expect(preset(page, "Big Lead")).toHaveCount(0);
  });
});
