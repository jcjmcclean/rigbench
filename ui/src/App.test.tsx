import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { fake, makeState } from "./test/fakeBridge";
import App from "./App";
import type { EngineState } from "./types";

// App against a controllable fake engine: lets us hold the app on the splash,
// fire errors before/after the first state, and replay exact engine states.
// (src/App.mock.test.tsx runs App against the real in-browser mock engine.)
vi.mock("./bridge", () => import("./test/bridgeModuleMock"));

beforeEach(() => fake.reset());

const presetTrigger = () => screen.getByRole("button", { name: /Preset/ });
const edited = () => within(presetTrigger()).queryByText(/edited/);
const emit = (s: EngineState) => act(() => fake.emitState(s));
const emitError = (m: string) => act(() => fake.emitError(m));

describe("App startup", () => {
  it("shows the connecting splash until the engine sends state", () => {
    render(<App />);
    const splash = screen.getByRole("status");
    expect(splash).toHaveTextContent("Connecting to engine…");
    expect(screen.queryByRole("main")).not.toBeInTheDocument();

    emit(makeState({ device: "Apollo Twin" }));
    expect(screen.queryByText("Connecting to engine…")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByText("Apollo Twin")).toBeInTheDocument();
  });

  it("renders straight away if the engine already has state", () => {
    fake.emitState(makeState());
    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("subscribes once to state and errors, and cleans up on unmount", () => {
    const { unmount } = render(<App />);
    emit(makeState());
    expect(fake.counts().state).toBe(1);
    expect(fake.counts().error).toBe(1);
    unmount();
    expect(fake.counts()).toEqual({ state: 0, error: 0, scope: 0 });
  });

  it("shows the mock-engine badge and version in the status bar", () => {
    render(<App />);
    emit(makeState());
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("Preview — mock engine");
    expect(footer).toHaveTextContent("v0.1");
    expect(footer).toHaveTextContent(/Drag knobs/);
  });
});

describe("App fatal error screen", () => {
  it("an error before any state replaces the splash with a fatal screen", () => {
    render(<App />);
    emitError("Couldn't reach the audio engine: timeout");
    expect(screen.getByRole("heading", { name: "Can’t reach the audio engine" })).toBeInTheDocument();
    expect(screen.getByText("Couldn't reach the audio engine: timeout")).toBeInTheDocument();
    expect(screen.queryByText("Connecting to engine…")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // not a toast
  });

  it("Retry reloads the page", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    try {
      render(<App />);
      emitError("boom");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("recovers into the app if state arrives after the fatal error", () => {
    render(<App />);
    emitError("slow start");
    emit(makeState());
    expect(screen.queryByRole("heading", { name: /Can’t reach/ })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});

describe("App error toasts", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("errors after state become dismissible toasts, not a fatal screen", () => {
    render(<App />);
    emit(makeState());
    emitError("Model failed to load");
    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Model failed to load");
    expect(screen.getByRole("main")).toBeInTheDocument();
    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dismissing one toast keeps the others", () => {
    render(<App />);
    emit(makeState());
    emitError("first");
    emitError("second");
    fireEvent.click(within(screen.getAllByRole("alert")[0]).getByRole("button"));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([expect.stringContaining("second")]);
  });

  it("toasts auto-dismiss after 6 s", () => {
    vi.useFakeTimers();
    render(<App />);
    emit(makeState());
    emitError("transient");
    act(() => { vi.advanceTimersByTime(5900); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("caps the stack at 4, keeping the newest", () => {
    render(<App />);
    emit(makeState());
    for (let i = 1; i <= 6; i++) emitError(`error ${i}`);
    const msgs = screen.getAllByRole("alert").map((a) => a.querySelector(".toast__msg")!.textContent);
    expect(msgs).toEqual(["error 3", "error 4", "error 5", "error 6"]);
  });

  it("identical consecutive errors each get their own toast", () => {
    render(<App />);
    emit(makeState());
    emitError("same");
    emitError("same");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });
});

describe("App dirty tracking (the 'edited' marker)", () => {
  const base = () => makeState({ activePreset: "Crunch", inputGain: 0.8 });

  it("is clean right after a preset is active", () => {
    render(<App />);
    emit(base());
    expect(presetTrigger()).toHaveTextContent("Crunch");
    expect(edited()).toBeNull();
  });

  it.each<[string, (s: EngineState) => EngineState]>([
    ["input gain", (s) => ({ ...s, inputGain: 0.9 })],
    ["master gain", (s) => ({ ...s, masterGain: 0.1 })],
    ["NAM level", (s) => ({ ...s, slots: { ...s.slots, nam: { ...s.slots.nam, gain: 0.7 } } })],
    ["IR mix", (s) => ({ ...s, slots: { ...s.slots, ir: { ...s.slots.ir, mix: 0.4 } } })],
    ["a bypass", (s) => ({ ...s, slots: { ...s.slots, nam: { ...s.slots.nam, bypassed: true } } })],
    ["a slot model", (s) => ({ ...s, slots: { ...s.slots, ir: { ...s.slots.ir, name: "Other IR" } } })],
    ["clearing a slot", (s) => ({ ...s, slots: { ...s.slots, ir: { ...s.slots.ir, loaded: false, name: "" } } })],
  ])("changing %s marks the preset edited", (_, change) => {
    render(<App />);
    emit(base());
    emit(change(base()));
    expect(edited()).toHaveTextContent("edited");
  });

  it.each<[string, Partial<EngineState>]>([
    ["meters", { inputLevel: 0.9, outputLevel: 0.7, playing: false }],
    ["monitoring", { monitoring: false }],
    ["telemetry", { roundTripMs: 30, device: "Other", sampleRate: 96000, bufferSize: 64 }],
    ["the preset list", { presets: ["Clean", "Crunch", "Lead", "New"] }],
  ])("%s changes do not count as edits", (_, over) => {
    render(<App />);
    emit(base());
    emit({ ...base(), ...over });
    expect(edited()).toBeNull();
  });

  it("clears when the rig is put back the way the preset had it", () => {
    render(<App />);
    emit(base());
    emit({ ...base(), inputGain: 0.9 });
    expect(edited()).not.toBeNull();
    emit(base());
    expect(edited()).toBeNull();
  });

  it("clears when another preset is loaded (new baseline)", () => {
    render(<App />);
    emit(base());
    emit({ ...base(), inputGain: 0.9 });
    emit({ ...base(), inputGain: 0.3, activePreset: "Lead" });
    expect(presetTrigger()).toHaveTextContent("Lead");
    expect(edited()).toBeNull();
    emit({ ...base(), inputGain: 0.35, activePreset: "Lead" });
    expect(edited()).not.toBeNull();
  });

  it("clears when the edited rig is saved under a new name", () => {
    render(<App />);
    emit(base());
    emit({ ...base(), inputGain: 0.9 });
    emit({ ...base(), inputGain: 0.9, activePreset: "Crunch v2", presets: [...base().presets, "Crunch v2"] });
    expect(edited()).toBeNull();
  });

  it("clears when the edited rig is saved over the active preset (same name)", async () => {
    render(<App />);
    emit(base());
    emit({ ...base(), inputGain: 0.9 });
    expect(edited()).not.toBeNull();

    // User saves over "Crunch" via the menu. The engine answers with a state whose
    // activePreset is unchanged ("Crunch") but whose stored rig is now this one.
    fake.bridge.savePreset.mockImplementation(() => fake.emitState({ ...base(), inputGain: 0.9 }));
    fireEvent.click(presetTrigger());
    fireEvent.click(screen.getByRole("option", { name: "+ Save current rig…" }));
    const field = screen.getByPlaceholderText("Preset name");
    fireEvent.change(field, { target: { value: "Crunch" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(fake.bridge.savePreset).toHaveBeenCalledWith("Crunch");
    expect(edited()).toBeNull();

    // ...and later edits are measured from the saved rig.
    emit({ ...base(), inputGain: 0.8 });
    expect(edited()).not.toBeNull();
  });

  it("a failed overwrite (engine sends no new state) leaves the preset edited", () => {
    render(<App />);
    emit(base());
    emit({ ...base(), inputGain: 0.9 });
    fireEvent.click(presetTrigger());
    fireEvent.click(screen.getByRole("option", { name: "+ Save current rig…" }));
    fireEvent.change(screen.getByPlaceholderText("Preset name"), { target: { value: "Crunch" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    emitError("Couldn't write preset");
    expect(edited()).not.toBeNull();
  });

  it("re-loading the active preset after edits resets the baseline to what the engine restores", () => {
    render(<App />);
    emit(base());
    emit({ ...base(), inputGain: 0.9 });
    fake.bridge.loadPreset.mockImplementation(() => fake.emitState(base()));
    fireEvent.click(presetTrigger());
    fireEvent.click(screen.getByRole("option", { name: "Crunch" }));
    expect(fake.bridge.loadPreset).toHaveBeenCalledWith("Crunch");
    expect(edited()).toBeNull();
  });

  it("with no active preset (Init) changes are still tracked", () => {
    render(<App />);
    emit(makeState({ activePreset: null }));
    expect(presetTrigger()).toHaveTextContent("Init");
    emit(makeState({ activePreset: null, masterGain: 0.2 }));
    expect(edited()).not.toBeNull();
  });
});
