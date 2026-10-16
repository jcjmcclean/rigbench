import { expect, type Locator, type Page } from "@playwright/test";

export type SlotKind = "VST3" | "NAM" | "IR";

/** Open the app (mock engine) and wait until it is past the splash. */
export async function openApp(page: Page) {
  await page.goto("/");
  await expect(page, "is this Tonebench's dev server? (see E2E_PORT in playwright.config.ts)").toHaveTitle("Tonebench");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Connecting to engine…")).toHaveCount(0);
}

/** A chain module (rack unit) by its type badge. */
export function slot(page: Page, kind: SlotKind): Locator {
  return page.locator("article.module").filter({ has: page.locator(".module__kind", { hasText: new RegExp(`^${kind}$`) }) });
}

export function knob(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("slider", { name, exact: true });
}

export function presetTrigger(page: Page): Locator {
  return page.getByRole("button", { name: /Preset/ });
}

export function editedMarker(page: Page): Locator {
  return presetTrigger(page).getByTitle("Unsaved changes");
}

/** Press on the centre of `target` and drag vertically by `dy` px (negative = up). */
export async function dragVertically(page: Page, target: Locator, dy: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("target has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 6 });
  await page.mouse.up();
}
