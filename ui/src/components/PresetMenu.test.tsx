import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fake } from "../test/fakeBridge";
import { PresetMenu } from "./PresetMenu";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

beforeEach(() => fake.reset());

const PRESETS = ["Clean", "Crunch", "Lead"];
const trigger = () => screen.getByRole("button", { name: /Preset/ });
const options = () => screen.getAllByRole("option");
// The "+" is decoration (aria-hidden), so it isn't read out as "plus".
const saveItem = () => screen.getByRole("option", { name: "Save current rig…" });

function renderMenu(props: Partial<{ presets: string[]; active: string | null; dirty: boolean }> = {}) {
  return render(<PresetMenu presets={PRESETS} active="Crunch" {...props} />);
}

describe("PresetMenu trigger", () => {
  it("shows the active preset name, collapsed", () => {
    renderMenu();
    expect(trigger()).toHaveTextContent("Crunch");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows No preset when no preset is active", () => {
    renderMenu({ active: null });
    expect(trigger()).toHaveTextContent("No preset");
  });

  it("shows the edited marker only when dirty", () => {
    const { rerender } = renderMenu({ dirty: false });
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
    rerender(<PresetMenu presets={PRESETS} active="Crunch" dirty />);
    expect(screen.getByTitle("Unsaved changes")).toHaveTextContent("edited");
  });
});

describe("PresetMenu open/close", () => {
  it("opens a Presets listbox with every preset plus save, rename and delete", () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Presets" })).toBeInTheDocument();
    expect(options().map((o) => o.textContent)).toEqual([
      "Clean", "Crunch", "Lead", "+ Save current rig…", "Rename “Crunch”…", "Delete “Crunch”…",
    ]);
  });

  it("offers only saving when no preset is active", () => {
    renderMenu({ active: null });
    fireEvent.click(trigger());
    expect(options().map((o) => o.textContent)).toEqual(["Clean", "Crunch", "Lead", "+ Save current rig…"]);
  });

  it("marks only the active preset as selected", () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(options().map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false", "false", "false"]);
  });

  it("focuses the active preset on open", () => {
    renderMenu({ active: "Lead" });
    fireEvent.click(trigger());
    expect(screen.getByRole("option", { name: "Lead" })).toHaveFocus();
  });

  it("focuses the first preset when none (or an unknown one) is active", () => {
    renderMenu({ active: null });
    fireEvent.click(trigger());
    expect(screen.getByRole("option", { name: "Clean" })).toHaveFocus();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.getByRole("option", { name: "Clean" })).toHaveFocus();
  });

  it("focuses the first preset when the active preset is not in the list", () => {
    renderMenu({ active: "Deleted elsewhere" });
    fireEvent.click(trigger());
    expect(screen.getByRole("option", { name: "Clean" })).toHaveFocus();
  });

  it("clicking the trigger again closes it", () => {
    renderMenu();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("a press outside closes it; a press inside does not", () => {
    render(
      <>
        <p>elsewhere</p>
        <PresetMenu presets={PRESETS} active="Crunch" />
      </>,
    );
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("option", { name: "Lead" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("PresetMenu keyboard", () => {
  function openAt(active: string | null = "Crunch") {
    renderMenu({ active });
    fireEvent.click(trigger());
    return document.activeElement as HTMLElement;
  }

  it("ArrowDown/ArrowUp move focus between options, including the save action", () => {
    let el = openAt("Lead");
    fireEvent.keyDown(el, { key: "ArrowDown" });
    expect(saveItem()).toHaveFocus();
    el = document.activeElement as HTMLElement;
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Lead" })).toHaveFocus();
  });

  const lastItem = () => screen.getByRole("option", { name: /^Delete/ });

  it("wraps around at both ends", () => {
    openAt("Clean");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(lastItem()).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Clean" })).toHaveFocus();
  });

  it("Home and End jump to the first and last option", () => {
    openAt("Crunch");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(lastItem()).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("option", { name: "Clean" })).toHaveFocus();
  });

  it("arrow keys don't scroll the page", () => {
    openAt();
    expect(fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" })).toBe(false);
  });

  it("Escape closes and returns focus to the trigger", () => {
    openAt();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("Enter on a focused option loads it (native button activation)", async () => {
    const user = userEvent.setup();
    renderMenu({ active: "Crunch" });
    await user.click(trigger());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(fake.bridge.loadPreset).toHaveBeenCalledExactlyOnceWith("Lead");
  });
});

describe("PresetMenu selecting a preset", () => {
  it("loads the clicked preset, closes, and returns focus to the trigger", () => {
    renderMenu();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Lead" }));
    expect(fake.bridge.loadPreset).toHaveBeenCalledExactlyOnceWith("Lead");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("re-selecting the active preset still asks the engine to load it (revert)", () => {
    renderMenu();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Crunch" }));
    expect(fake.bridge.loadPreset).toHaveBeenCalledWith("Crunch");
  });
});

describe("PresetMenu save flow", () => {
  async function openSave(active: string | null = "Crunch") {
    const user = userEvent.setup();
    renderMenu({ active });
    await user.click(trigger());
    await user.click(saveItem());
    return user;
  }
  const nameField = () => screen.getByRole("textbox", { name: "Preset name" });
  const saveBtn = () => screen.getByRole("button", { name: "Save" });

  it("closes the menu and opens a Save dialog prefilled with '<active> copy', focused", async () => {
    await openSave();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Save current rig" })).toBeInTheDocument();
    expect(nameField()).toHaveValue("Crunch copy");
    expect(nameField()).toHaveFocus();
    expect(saveBtn()).toBeEnabled();
  });

  it("warns before replacing an existing preset (ignoring case) and says Replace", async () => {
    const user = await openSave();
    expect(screen.queryByText(/Saving will replace it/)).not.toBeInTheDocument();
    await user.clear(nameField());
    await user.type(nameField(), "  lead ");
    expect(screen.getByRole("status")).toHaveTextContent("There’s already a preset called “Lead”. Saving will replace it.");
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(fake.bridge.savePreset).toHaveBeenCalledExactlyOnceWith("lead");
  });

  it("starts empty (Save disabled) when no preset is active", async () => {
    await openSave(null);
    expect(nameField()).toHaveValue("");
    expect(saveBtn()).toBeDisabled();
  });

  it("Save sends the typed name to the engine and closes the dialog", async () => {
    const user = await openSave();
    await user.clear(nameField());
    await user.type(nameField(), "Big Muff Lead");
    await user.click(saveBtn());
    expect(fake.bridge.savePreset).toHaveBeenCalledExactlyOnceWith("Big Muff Lead");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Enter in the field saves", async () => {
    const user = await openSave();
    await user.type(nameField(), "{Enter}");
    expect(fake.bridge.savePreset).toHaveBeenCalledExactlyOnceWith("Crunch copy");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("trims surrounding whitespace from the name", async () => {
    const user = await openSave();
    await user.clear(nameField());
    await user.type(nameField(), "   Spaced Out  ");
    await user.click(saveBtn());
    expect(fake.bridge.savePreset).toHaveBeenCalledExactlyOnceWith("Spaced Out");
  });

  it.each([["empty", ""], ["whitespace-only", "    "]])("rejects an %s name: Save disabled, Enter ignored", async (_, typed) => {
    const user = await openSave();
    await user.clear(nameField());
    if (typed) await user.type(nameField(), typed);
    expect(saveBtn()).toBeDisabled();
    await user.type(nameField(), "{Enter}");
    fireEvent.click(saveBtn());
    expect(fake.bridge.savePreset).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Cancel closes without saving", async () => {
    const user = await openSave();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.bridge.savePreset).not.toHaveBeenCalled();
  });

  it("Escape closes without saving", async () => {
    const user = await openSave();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.bridge.savePreset).not.toHaveBeenCalled();
  });

  it("re-opening after a save starts from '<active> copy' again", async () => {
    const user = await openSave();
    await user.clear(nameField());
    await user.type(nameField(), "First{Enter}");
    await user.click(trigger());
    await user.click(saveItem());
    expect(nameField()).toHaveValue("Crunch copy");
  });

  it("doesn't load a preset while saving", async () => {
    const user = await openSave();
    await user.type(nameField(), "{Enter}");
    expect(fake.bridge.loadPreset).not.toHaveBeenCalled();
  });

  it("tells the owner which name was saved (after asking the engine), and only on save", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<PresetMenu presets={PRESETS} active="Crunch" onSaved={onSaved} />);
    await user.click(trigger());
    await user.click(saveItem());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(trigger());
    await user.click(saveItem());
    await user.clear(nameField());
    await user.type(nameField(), "  Crunch {Enter}");
    expect(onSaved).toHaveBeenCalledExactlyOnceWith("Crunch");
    expect(fake.bridge.savePreset.mock.invocationCallOrder[0]).toBeLessThan(onSaved.mock.invocationCallOrder[0]);
  });
});

describe("PresetMenu rename and delete", () => {
  async function openAction(label: RegExp) {
    const user = userEvent.setup();
    renderMenu({ active: "Crunch" });
    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: label }));
    return user;
  }

  it("renames the active preset (a rename isn't a save)", async () => {
    const onSaved = vi.fn();
    const onRenamed = vi.fn();
    const user = userEvent.setup();
    render(<PresetMenu presets={PRESETS} active="Crunch" onSaved={onSaved} onRenamed={onRenamed} />);
    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: /^Rename/ }));
    const field = screen.getByRole("textbox", { name: "New name" });
    expect(field).toHaveValue("Crunch");
    await user.clear(field);
    await user.type(field, " Big Crunch {Enter}");
    expect(fake.bridge.renamePreset).toHaveBeenCalledExactlyOnceWith("Crunch", "Big Crunch");
    expect(onRenamed).toHaveBeenCalledExactlyOnceWith("Big Crunch");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("won't rename onto another preset's name, but allows a change of case", async () => {
    const user = await openAction(/^Rename/);
    const field = screen.getByRole("textbox", { name: "New name" });
    await user.clear(field);
    await user.type(field, "lead");
    expect(screen.getByRole("status")).toHaveTextContent("There’s already a preset called “Lead”. Pick another name.");
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(fake.bridge.renamePreset).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, "CRUNCH");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(fake.bridge.renamePreset).toHaveBeenCalledExactlyOnceWith("Crunch", "CRUNCH");
  });

  it("renaming to the same name just closes", async () => {
    const user = await openAction(/^Rename/);
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(fake.bridge.renamePreset).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes the active preset after asking", async () => {
    const user = await openAction(/^Delete/);
    const dialog = screen.getByRole("dialog", { name: "Delete “Crunch”?" });
    expect(dialog).toHaveTextContent("This deletes the preset file for good. What you’re playing now won’t change.");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(fake.bridge.deletePreset).toHaveBeenCalledExactlyOnceWith("Crunch");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cancel keeps it", async () => {
    const user = await openAction(/^Delete/);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fake.bridge.deletePreset).not.toHaveBeenCalled();
  });
});
