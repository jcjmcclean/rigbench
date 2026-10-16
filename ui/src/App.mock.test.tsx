import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// App wired to the REAL in-browser mock engine (createMockBridge in bridge.ts),
// i.e. what the dev server and the website previews run. Each test gets a fresh
// engine (vi.resetModules), with its 50 ms meter interval on fake timers so the
// tests control when meters tick. Fine-grained engine scenarios (errors, splash,
// exact state replays) live in App.test.tsx with a fake bridge.

async function renderApp() {
  // Importing juce-framework-frontend leaves a placeholder window.__JUCE__ (with
  // a stub backend) behind; drop it so the fresh import detects "no engine" again.
  delete window.__JUCE__;
  // ...and mute the warning it prints about that placeholder (expected here).
  const warn = console.warn.bind(console);
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("window.__JUCE__")) warn(...args);
  });
  vi.resetModules();
  const { default: App } = await import("./App");
  const utils = render(<App />);
  return utils;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const KIND = { vst3: "VST3", nam: "NAM", ir: "IR" } as const;
const slot = (type: keyof typeof KIND) =>
  within(screen.getByText(KIND[type], { selector: ".module__kind" }).closest("article")!);
const presetTrigger = () => screen.getByRole("button", { name: /Preset/ });
const edited = () => within(presetTrigger()).queryByText(/edited/);
const tick = (ms = 50) => act(() => { vi.advanceTimersByTime(ms); });
const litIn = (c: HTMLElement) => c.querySelectorAll(".terminal--in .meter__seg.is-on").length;

describe("App + mock engine: first paint", () => {
  it("skips the splash and shows the default rig", async () => {
    await renderApp();
    expect(screen.queryByText("Connecting to engine…")).not.toBeInTheDocument();
    expect(screen.getByText("Universal Audio Apollo")).toBeInTheDocument();
    expect(screen.getByText("48.0 kHz")).toBeInTheDocument();
    expect(screen.getByText("7.4 ms · low")).toBeInTheDocument();
    expect(presetTrigger()).toHaveTextContent("Hiwatt Lead");
    expect(edited()).toBeNull();
    expect(slot("vst3").getByRole("button", { name: /Load a plugin/ })).toBeInTheDocument();
    expect(slot("nam").getByText("Fig HW C50 MG 412")).toBeInTheDocument();
    expect(slot("ir").getByText("Mesa 4x12 — SM57")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Gain" })).toHaveAttribute("aria-valuetext", "80");
    expect(screen.getByRole("slider", { name: "Level" })).toHaveAttribute("aria-valuetext", "+0 dB");
    expect(screen.getByRole("slider", { name: "Mix" })).toHaveAttribute("aria-valuetext", "100%");
    expect(screen.getByText("Preview — mock engine")).toBeInTheDocument();
  });

  it("animates the meters while monitoring", async () => {
    const { container } = await renderApp();
    expect(litIn(container)).toBe(0);
    tick(50);
    expect(litIn(container)).toBeGreaterThan(0);
  });
});

describe("App + mock engine: knobs", () => {
  it("keyboard on the input Gain knob changes its value and marks the preset edited", async () => {
    await renderApp();
    const gain = screen.getByRole("slider", { name: "Gain" });
    fireEvent.keyDown(gain, { key: "ArrowUp" });
    expect(gain).toHaveAttribute("aria-valuetext", "85");
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(edited()).toHaveTextContent("edited");
  });

  it("wheel over the Master knob adjusts it", async () => {
    await renderApp();
    const master = screen.getByRole("slider", { name: "Master" });
    fireEvent.wheel(master, { deltaY: 100 });
    expect(master).toHaveAttribute("aria-valuetext", "77");
  });

  it("dragging the NAM Level knob changes dB", async () => {
    await renderApp();
    const level = screen.getByRole("slider", { name: "Level" });
    fireEvent.pointerDown(level, { clientY: 300 });
    fireEvent.pointerMove(level, { clientY: 255 }); // +0.25 -> 0.75 -> +12 dB
    fireEvent.pointerUp(level, { clientY: 255 });
    expect(level).toHaveAttribute("aria-valuetext", "+12 dB");
    expect(edited()).not.toBeNull();
  });

  it("meter ticks don't mark the preset edited", async () => {
    await renderApp();
    tick(500);
    expect(edited()).toBeNull();
  });
});

describe("App + mock engine: slots", () => {
  it("bypass toggles ON -> BYPASS -> ON", async () => {
    await renderApp();
    fireEvent.click(slot("nam").getByRole("button", { name: "ON" }));
    expect(slot("nam").getByRole("button", { name: "BYPASS" })).toHaveAttribute("aria-pressed", "true");
    expect(edited()).not.toBeNull();
    fireEvent.click(slot("nam").getByRole("button", { name: "BYPASS" }));
    expect(slot("nam").getByRole("button", { name: "ON" })).toHaveAttribute("aria-pressed", "false");
    expect(edited()).toBeNull(); // back to the preset's rig
  });

  it("Change cycles through the amp models", async () => {
    await renderApp();
    const change = () => fireEvent.click(slot("nam").getByRole("button", { name: "Change" }));
    change();
    expect(slot("nam").getByText("Fig HW DR Hot 212")).toBeInTheDocument();
    change();
    expect(slot("nam").getByText("Fig HW C50 MG DI")).toBeInTheDocument();
    change();
    expect(slot("nam").getByText("Fig HW C50 MG 412")).toBeInTheDocument();
  });

  it("clearing a slot shows its load state; loading fills it again", async () => {
    await renderApp();
    fireEvent.click(slot("ir").getByTitle("Remove"));
    expect(slot("ir").queryByText("Mesa 4x12 — SM57")).not.toBeInTheDocument();
    const load = slot("ir").getByRole("button", { name: /Load a cab IR/ });
    fireEvent.click(load);
    expect(slot("ir").getByText("Hiwatt SE4123 — R121")).toBeInTheDocument();
    expect(slot("ir").getByRole("slider", { name: "Mix" })).toHaveAttribute("aria-valuetext", "100%");
  });

  it("loading the empty VST3 slot offers the plugin editor", async () => {
    await renderApp();
    fireEvent.click(slot("vst3").getByRole("button", { name: /Load a plugin/ }));
    expect(slot("vst3").getByText("SICO High Gain")).toBeInTheDocument();
    expect(slot("vst3").getByRole("button", { name: /Open editor/ })).toBeInTheDocument();
  });
});

describe("App + mock engine: monitoring", () => {
  it("LIVE toggles to Muted (meters fall silent) and back", async () => {
    const { container } = await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Live/ }));
    expect(screen.getByRole("button", { name: /Muted/ })).toBeInTheDocument();
    tick(200);
    expect(litIn(container)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /Muted/ }));
    expect(screen.getByRole("button", { name: /Live/ })).toBeInTheDocument();
    tick(50);
    expect(litIn(container)).toBeGreaterThan(0);
  });
});

describe("App + mock engine: presets", () => {
  it("loading another preset clears the edited marker", async () => {
    await renderApp();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Gain" }), { key: "ArrowUp" });
    expect(edited()).not.toBeNull();
    fireEvent.click(presetTrigger());
    fireEvent.click(screen.getByRole("option", { name: "Page Crunch" }));
    expect(presetTrigger()).toHaveTextContent("Page Crunch");
    expect(edited()).toBeNull();
  });

  it("saving a new preset adds it to the list, makes it active and clears edited", async () => {
    vi.useRealTimers(); // user-event's typing delays need real timers
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const user = userEvent.setup();
    await renderApp();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Master" }), { key: "ArrowDown" });
    expect(edited()).not.toBeNull();

    await user.click(presetTrigger());
    await user.click(screen.getByRole("option", { name: "+ Save current rig…" }));
    const field = screen.getByPlaceholderText("Preset name");
    await user.clear(field);
    await user.type(field, "Quiet Lead{Enter}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(presetTrigger()).toHaveTextContent("Quiet Lead");
    expect(edited()).toBeNull();
    await user.click(presetTrigger());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Gilmour Clean", "Page Crunch", "Hiwatt Lead", "Bedroom Low-Volume", "Quiet Lead", "+ Save current rig…",
    ]);
    expect(screen.getByRole("option", { name: "Quiet Lead" })).toHaveAttribute("aria-selected", "true");
  });

  it("saving over the active preset clears edited without duplicating it", async () => {
    await renderApp();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Master" }), { key: "ArrowDown" });
    fireEvent.click(presetTrigger());
    fireEvent.click(screen.getByRole("option", { name: "+ Save current rig…" }));
    fireEvent.change(screen.getByPlaceholderText("Preset name"), { target: { value: "Hiwatt Lead" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(presetTrigger()).toHaveTextContent("Hiwatt Lead");
    expect(edited()).toBeNull();
    fireEvent.click(presetTrigger());
    expect(screen.getAllByRole("option", { name: "Hiwatt Lead" })).toHaveLength(1);
  });

  it("the save dialog keeps keyboard focus where the user puts it while meters stream", async () => {
    await renderApp();
    fireEvent.click(presetTrigger());
    fireEvent.click(screen.getByRole("option", { name: "+ Save current rig…" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    tick(300); // six meter ticks re-render the whole app
    expect(cancel).toHaveFocus();
  });
});

describe("App + mock engine: first-run setup (?setup)", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); });

  it("walks the wizard: interface, finds the guitar on Input 2, output, then plays live", async () => {
    window.history.replaceState(null, "", "/?setup");
    await renderApp();
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "What’s your guitar plugged into?" })).toBeInTheDocument();
    expect(screen.getByText(/computer’s own microphone/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Muted/ })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Scarlett 2i2 USB" }));
    await waitFor(() => expect(screen.queryByText(/computer’s own microphone/)).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Play a few notes" });
    tick(50);
    expect(screen.getByText("Found your guitar on Input 2.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Where do you want to hear it?" });
    expect(screen.getByRole("radio", { name: "Scarlett 2i2 USB" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Start playing" }));

    expect(screen.queryByRole("heading", { name: /Where do you want/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Live/ })).toBeInTheDocument();
    expect(screen.getByText("Scarlett 2i2 USB", { selector: ".telem__value" })).toBeInTheDocument();
  });

  it("without ?setup there's no wizard", async () => {
    await renderApp();
    expect(screen.queryByRole("heading", { name: "What’s your guitar plugged into?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
