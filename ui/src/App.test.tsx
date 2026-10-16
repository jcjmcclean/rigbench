import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fake, makeState } from "./test/fakeBridge";
import App, { CONNECT_TIMEOUT_MS, VERSION } from "./App";
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
    expect(splash).toHaveTextContent("Connecting to the audio engine…");
    expect(screen.queryByRole("main")).not.toBeInTheDocument();

    emit(makeState({ device: "Apollo Twin" }));
    expect(screen.queryByText("Connecting to the audio engine…")).not.toBeInTheDocument();
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

  it("shows the preview badge, version and knob hint in the status bar", () => {
    render(<App />);
    emit(makeState());
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("Preview: no sound");
    expect(VERSION).toBe("0.1.0");
    expect(footer).toHaveTextContent(/v0\.1\.0$/);
    expect(within(footer).getByText(/^Drag a knob/)).toHaveTextContent(
      /^Drag a knob, or use the arrow keys or scroll wheel\. Hold Shift for finer control\.$/,
    );
  });

  it("leaves the scroll wheel out of the hint when the wheel is off (the website showcase)", () => {
    render(<App wheel={false} />);
    emit(makeState());
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(/^Drag a knob/)).toHaveTextContent(
      /^Drag a knob, or use the arrow keys\. Hold Shift for finer control\.$/,
    );
    expect(footer).not.toHaveTextContent(/wheel|scroll/);
  });
});

describe("App fatal error screen", () => {
  it("an error before any state replaces the splash with a fatal screen", () => {
    render(<App />);
    emitError("Couldn't reach the audio engine: timeout");
    expect(screen.getByRole("heading", { name: "Can’t reach the audio engine" })).toBeInTheDocument();
    expect(screen.getByText("Couldn't reach the audio engine: timeout")).toBeInTheDocument();
    expect(screen.queryByText("Connecting to the audio engine…")).not.toBeInTheDocument();
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

  it("toasts auto-dismiss after 6 s plus time to read them", () => {
    vi.useFakeTimers();
    render(<App />);
    emit(makeState());
    emitError("transient");   // 9 characters: 6540 ms
    act(() => { vi.advanceTimersByTime(6500); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(100); });
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
    fireEvent.click(screen.getByRole("option", { name: "Save current rig…" }));
    const field = screen.getByRole("textbox", { name: "Preset name" });
    fireEvent.change(field, { target: { value: "Crunch" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
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
    fireEvent.click(screen.getByRole("option", { name: "Save current rig…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: "Crunch" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
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

  it("renaming the active preset keeps it edited (a rename doesn't save)", async () => {
    const user = userEvent.setup();
    render(<App />);
    emit(base());
    emit({ ...base(), inputGain: 0.9 });
    expect(edited()).not.toBeNull();
    // The engine follows the rename: the active preset takes the new name.
    fake.bridge.renamePreset.mockImplementation((_from: string, to: string) =>
      fake.emitState({ ...base(), inputGain: 0.9, activePreset: to }));
    await user.click(presetTrigger());
    await user.click(screen.getByRole("option", { name: /^Rename/ }));
    const field = screen.getByRole("textbox", { name: "New name" });
    await user.clear(field);
    await user.type(field, "Crunch 2{Enter}");
    expect(fake.bridge.renamePreset).toHaveBeenCalledExactlyOnceWith("Crunch", "Crunch 2");
    expect(presetTrigger()).toHaveTextContent("Crunch 2");
    expect(edited()).not.toBeNull();
    // The baseline is still the rig as it was saved.
    emit({ ...base(), activePreset: "Crunch 2" });
    expect(edited()).toBeNull();
  });

  it("renaming a clean preset stays clean", async () => {
    const user = userEvent.setup();
    render(<App />);
    emit(base());
    fake.bridge.renamePreset.mockImplementation((_from: string, to: string) =>
      fake.emitState({ ...base(), activePreset: to }));
    await user.click(presetTrigger());
    await user.click(screen.getByRole("option", { name: /^Rename/ }));
    const field = screen.getByRole("textbox", { name: "New name" });
    await user.clear(field);
    await user.type(field, "Crunch 2{Enter}");
    expect(presetTrigger()).toHaveTextContent("Crunch 2");
    expect(edited()).toBeNull();
  });

  it("with no active preset (No preset) changes are still tracked", () => {
    render(<App />);
    emit(makeState({ activePreset: null }));
    expect(presetTrigger()).toHaveTextContent("No preset");
    emit(makeState({ activePreset: null, masterGain: 0.2 }));
    expect(edited()).not.toBeNull();
  });
});

describe("App connect timeout", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("waits 8 s for the engine", () => {
    expect(CONNECT_TIMEOUT_MS).toBe(8000);
  });

  it("gives up with the fatal screen if no state arrives in time", () => {
    vi.useFakeTimers();
    render(<App />);
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1); });
    expect(screen.getByText("Connecting to the audio engine…")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("heading", { name: "Can’t reach the audio engine" })).toBeInTheDocument();
    expect(screen.getByText(
      "The window opened, but the audio engine didn’t answer. Click Retry. If that doesn’t help, quit Tonebench and open it again.",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Connecting to the audio engine…")).not.toBeInTheDocument();
  });

  it("doesn't fire once state has arrived", () => {
    vi.useFakeTimers();
    render(<App />);
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS / 2); });
    emit(makeState());
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2); });
    expect(screen.queryByRole("heading", { name: /Can’t reach/ })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("doesn't fire when the engine already has state at first render", () => {
    vi.useFakeTimers();
    fake.emitState(makeState());
    render(<App />);
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2); });
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("recovers into the app if state turns up after giving up", () => {
    vi.useFakeTimers();
    render(<App />);
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS); });
    expect(screen.getByRole("heading", { name: "Can’t reach the audio engine" })).toBeInTheDocument();
    emit(makeState());
    expect(screen.queryByRole("heading", { name: /Can’t reach/ })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("doesn't fire after unmount", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error");
    const { unmount } = render(<App />);
    unmount();
    act(() => { vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2); });
    expect(err).not.toHaveBeenCalled();
  });
});

describe("App first-run setup", () => {
  const setupHeading = () => screen.findByRole("heading", { name: "What’s your guitar plugged into?" });
  const settingsDialog = () => screen.queryByRole("dialog", { name: "Settings" });

  it("shows the setup wizard over the app until the engine says setup is complete", async () => {
    render(<App />);
    emit(makeState({ setupComplete: false, monitoring: false }));
    expect(await setupHeading()).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hear your guitar" })).toHaveTextContent("Muted");
  });

  it("doesn't show the wizard once setup is complete", () => {
    render(<App />);
    emit(makeState({ setupComplete: true }));
    expect(screen.queryByText("What’s your guitar plugged into?")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.bridge.getAudioSetup).not.toHaveBeenCalled();
  });

  it("finishing tells the engine; the wizard goes when the engine confirms", async () => {
    const user = userEvent.setup();
    render(<App />);
    emit(makeState({ setupComplete: false, monitoring: false }));
    await setupHeading();
    await user.click(screen.getByRole("button", { name: "Skip setup" }));
    expect(fake.bridge.finishSetup).toHaveBeenCalledExactlyOnceWith(false);
    // Skip leaves monitoring off.
    expect(fake.bridge.setMonitor).not.toHaveBeenCalled();
    emit(makeState({ setupComplete: true, monitoring: false }));
    expect(screen.queryByText("What’s your guitar plugged into?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hear your guitar" })).toHaveTextContent("Muted");
  });

  it("no Settings while the wizard is up, even if the engine's menu asks", async () => {
    render(<App />);
    emit(makeState({ setupComplete: false }));
    await setupHeading();
    act(() => fake.emitShowSettings());
    expect(settingsDialog()).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // ...and it isn't saved up to pop open once setup is done.
    emit(makeState({ setupComplete: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the full wizard drives the engine: listen to all, pick the input, finish", async () => {
    const user = userEvent.setup();
    render(<App />);
    emit(makeState({ setupComplete: false, monitoring: false }));
    await setupHeading();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Play a few notes" });
    act(() => fake.emitInputPeaks([0.004, 0.5]));
    expect(screen.getByText("Found your guitar on Input 2.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Where do you want to hear it?" });
    await user.click(screen.getByRole("button", { name: "Start playing" }));
    expect(fake.bridge.setAudioSetup.mock.calls.map(([c]) => c)).toEqual([{ listenToAllInputs: true }, { input: 1 }]);
    expect(fake.bridge.finishSetup).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe("App Settings", () => {
  const settingsDialog = () => screen.queryByRole("dialog", { name: "Settings" });

  it("the gear opens Settings; Done closes it", async () => {
    const user = userEvent.setup();
    render(<App />);
    emit(makeState());
    expect(settingsDialog()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(settingsDialog()).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Audio interface" })).toHaveValue("Test Interface");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(settingsDialog()).not.toBeInTheDocument();
  });

  it("the engine's showSettings event (the app menu) opens Settings", async () => {
    render(<App />);
    emit(makeState());
    act(() => fake.emitShowSettings());
    expect(settingsDialog()).toBeInTheDocument();
    await screen.findByText(/Running at/);
  });

  it("showSettings while Settings is already open keeps a single dialog", async () => {
    render(<App />);
    emit(makeState());
    act(() => fake.emitShowSettings());
    act(() => fake.emitShowSettings());
    expect(screen.getAllByRole("dialog", { name: "Settings" })).toHaveLength(1);
    await screen.findByText(/Running at/);
  });

  it("Run setup again closes Settings and shows the wizard; finishing returns to the app", async () => {
    const user = userEvent.setup();
    render(<App />);
    emit(makeState({ setupComplete: true }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByText(/Running at/);
    await user.click(screen.getByRole("button", { name: "Run setup again" }));
    expect(settingsDialog()).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "What’s your guitar plugged into?" })).toBeInTheDocument();
    // Monitoring was on, so setup mutes while it listens to every input.
    expect(fake.bridge.setMonitor).toHaveBeenCalledWith(false);
    // The engine already counts setup as done, so finishing hides it straight away.
    await user.click(screen.getByRole("button", { name: "Skip setup" }));
    expect(fake.bridge.finishSetup).toHaveBeenCalledExactlyOnceWith(false);
    // Skip puts monitoring back as it was.
    expect(fake.bridge.setMonitor).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText("What’s your guitar plugged into?")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["the tuner", "Tuner", async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "Tuner" }));
    }],
    ["the plugin picker", "Load a plugin", async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: /Load a plugin/ }));
    }],
    ["a preset dialog", "Save current rig", async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(presetTrigger());
      await user.click(screen.getByRole("option", { name: "Save current rig…" }));
    }],
  ])("showSettings while %s is open is ignored: one dialog at a time", async (_, title, open) => {
    const user = userEvent.setup();
    const s = makeState({ activePreset: "Crunch" });
    s.slots.vst3 = { type: "vst3", loaded: false, name: "", bypassed: false };
    render(<App />);
    emit(s);
    await open(user);
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
    act(() => fake.emitShowSettings());
    expect(settingsDialog()).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // Once it's closed, Settings opens as normal.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => fake.emitShowSettings());
    expect(settingsDialog()).toBeInTheDocument();
    await screen.findByText(/Running at/);
  });

  it("subscribes to showSettings once, and unsubscribes on unmount", () => {
    const { unmount } = render(<App />);
    emit(makeState());
    expect(fake.setupCounts().showSettings).toBe(1);
    unmount();
    expect(fake.setupCounts()).toEqual({ inputPeaks: 0, showSettings: 0 });
  });
});

describe("App Tuner", () => {
  const tunerDialog = () => screen.queryByRole("dialog", { name: "Tuner" });

  it("the tuner button opens it (engine tuner on); Done closes it (engine tuner off)", async () => {
    const user = userEvent.setup();
    render(<App />);
    emit(makeState());
    await user.click(screen.getByRole("button", { name: "Tuner" }));
    expect(tunerDialog()).toBeInTheDocument();
    expect(fake.bridge.setTuner).toHaveBeenLastCalledWith(true);

    act(() => fake.emitTuner({ note: "D", octave: 3, cents: 0, hz: 146.8 }));
    expect(within(tunerDialog()!).getByText("D")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(tunerDialog()).not.toBeInTheDocument();
    expect(fake.bridge.setTuner).toHaveBeenLastCalledWith(false);
  });

  it("isn't shown over first-run setup", async () => {
    const user = userEvent.setup();
    render(<App />);
    emit(makeState({ setupComplete: false }));
    await user.click(screen.getByRole("button", { name: "Tuner" }));
    expect(tunerDialog()).not.toBeInTheDocument();
  });
});

describe("App: the gate counts as part of the rig", () => {
  it("changing it marks the preset edited", () => {
    render(<App />);
    emit(makeState({ gate: 0 }));
    expect(edited()).not.toBeInTheDocument();
    emit(makeState({ gate: 0.4 }));
    expect(edited()).toBeInTheDocument();
  });
});

describe("App: a preset whose plugin arrives late", () => {
  it("isn't 'edited' while the plugin is pending or when it lands", () => {
    render(<App />);
    emit(makeState({ activePreset: "Crunch" }));
    // Load "Lead": the engine sets the IR/NAM, and asks about the plugin.
    const empty = makeState().slots;
    emit(makeState({ activePreset: "Lead", loadingPreset: true }));
    expect(edited()).not.toBeInTheDocument();
    // The plugin lands in the same push that clears loadingPreset.
    emit(makeState({
      activePreset: "Lead",
      loadingPreset: false,
      slots: { ...empty, vst3: { type: "vst3", loaded: true, name: "BYOD", bypassed: false, hasEditor: true } },
    }));
    expect(edited()).not.toBeInTheDocument();
    // A real change afterwards still counts.
    emit(makeState({
      activePreset: "Lead",
      loadingPreset: false,
      masterGain: 0.3,
      slots: { ...empty, vst3: { type: "vst3", loaded: true, name: "BYOD", bypassed: false, hasEditor: true } },
    }));
    expect(edited()).toBeInTheDocument();
  });
});
