import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineState } from "./types";

// bridge.ts is the single riskiest piece of glue in the app: it picks the real
// JUCE backend vs. a browser mock, wires native functions, and merges meter
// events into cached state. We mock juce-framework-frontend entirely (the real
// vendor module touches window.__JUCE__.initialisationData at import time and
// would throw here) and drive a fake backend's event listeners by hand.

const { getStateMock, getNativeFunctionMock } = vi.hoisted(() => {
  const getStateMock = vi.fn();
  const getNativeFunctionMock = vi.fn((name: string) =>
    name === "getState" ? getStateMock : vi.fn(),
  );
  return { getStateMock, getNativeFunctionMock };
});

vi.mock("juce-framework-frontend", () => ({
  getNativeFunction: getNativeFunctionMock,
}));

type JuceWin = typeof globalThis & {
  __JUCE__?: { backend?: unknown };
};

// A fake JUCE backend whose addEventListener registers handlers we can fire.
function installBackend() {
  const listeners = new Map<string, Array<(p: unknown) => void>>();
  const backend = {
    addEventListener: (id: string, cb: (p: unknown) => void) => {
      const arr = listeners.get(id) ?? [];
      arr.push(cb);
      listeners.set(id, arr);
      return arr.length - 1;
    },
    removeEventListener: vi.fn(),
  };
  (globalThis as JuceWin).__JUCE__ = { backend };
  return {
    emit: (id: string, payload: unknown) =>
      (listeners.get(id) ?? []).forEach((cb) => cb(payload)),
  };
}

function makeState(over: Partial<EngineState> = {}): EngineState {
  return {
    device: "Test Device",
    sampleRate: 48000,
    bufferSize: 128,
    roundTripMs: 7,
    setupComplete: true,
    monitoring: true,
    inputGain: 0.8,
    gate: 0,
    masterGain: 0.8,
    playing: true,
    inputLevel: 0,
    outputLevel: 0,
    slots: {
      vst3: { type: "vst3", loaded: false, name: "", bypassed: false },
      nam: { type: "nam", loaded: false, name: "", bypassed: false },
      ir: { type: "ir", loaded: false, name: "", bypassed: false },
    },
    presets: [],
    activePreset: null,
    loadingPreset: false,
    ...over,
  };
}

async function importBridge() {
  vi.resetModules();
  return import("./bridge");
}

beforeEach(() => {
  getStateMock.mockResolvedValue(makeState());
});

afterEach(() => {
  delete (globalThis as JuceWin).__JUCE__;
});

describe("mock vs. real detection", () => {
  it("uses the mock bridge when there is no native backend", async () => {
    delete (globalThis as JuceWin).__JUCE__;
    const { isMock, bridge } = await importBridge();
    expect(isMock).toBe(true);
    const state = await bridge.getState();
    // The mock ships a believable default rig.
    expect(state.slots.nam.loaded).toBe(true);
    expect(getNativeFunctionMock).not.toHaveBeenCalled();
  });

  it("uses the real JUCE bridge when a backend is present", async () => {
    installBackend();
    const { isMock } = await importBridge();
    expect(isMock).toBe(false);
    // Real bridge wires every native function up front.
    expect(getNativeFunctionMock).toHaveBeenCalledWith("getState");
    expect(getNativeFunctionMock).toHaveBeenCalledWith("loadSlot");
  });
});

describe("real bridge: subscribe + state events", () => {
  it("delivers the current state to new subscribers and on every state event", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();

    emit("state", makeState({ device: "Apollo" })); // sets cached current

    const seen: EngineState[] = [];
    const unsub = bridge.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1); // immediate replay of current
    expect(seen[0].device).toBe("Apollo");

    emit("state", makeState({ device: "Scarlett", inputLevel: 0.2 }));
    expect(seen).toHaveLength(2);
    expect(seen[1].device).toBe("Scarlett");

    unsub();
    emit("state", makeState({ device: "Clarett" }));
    expect(seen).toHaveLength(2); // no delivery after unsubscribe
  });
});

describe("real bridge: meter state-merge", () => {
  it("merges meter fields onto the cached state, preserving the rest", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();

    emit("state", makeState({ device: "Apollo", masterGain: 0.5 }));
    const seen: EngineState[] = [];
    bridge.subscribe((s) => seen.push(s));

    emit("meters", { inputLevel: 0.7, outputLevel: 0.4 });

    const last = seen[seen.length - 1];
    expect(last.inputLevel).toBe(0.7);
    expect(last.outputLevel).toBe(0.4);
    // Everything NOT in the meter payload survives the `{...current, ...m}` merge.
    expect(last.device).toBe("Apollo");
    expect(last.masterGain).toBe(0.5);
  });

  it("silently drops meter events that arrive before any state (null-current risk)", async () => {
    // Documents the ordering hazard in bridge.ts: `if (current) current = {...}`
    // means a meters event before the first state event is a no-op.
    const { emit } = installBackend();
    getStateMock.mockReturnValue(new Promise<EngineState>(() => {})); // never resolves
    const { bridge } = await importBridge();

    const seen: EngineState[] = [];
    bridge.subscribe((s) => seen.push(s)); // current is null -> awaits getState

    expect(() => emit("meters", { inputLevel: 0.9 })).not.toThrow();
    expect(seen).toHaveLength(0); // meter update dropped, no subscriber call
  });
});

describe("real bridge: error channel", () => {
  it("forwards backend error events to error subscribers", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();

    const errors: string[] = [];
    bridge.subscribeError((m) => errors.push(m));
    emit("error", "model failed to load");
    expect(errors).toEqual(["model failed to load"]);
  });
});

describe("errorMessage (engine error payload -> text)", () => {
  async function load() {
    delete (globalThis as JuceWin).__JUCE__;
    return (await importBridge()).errorMessage;
  }
  const FALLBACK = "Something went wrong in the audio engine.";

  it("passes a bare string through unchanged", async () => {
    const errorMessage = await load();
    expect(errorMessage("Model failed to load")).toBe("Model failed to load");
  });

  it("reads { message } (the engine's payload shape)", async () => {
    const errorMessage = await load();
    expect(errorMessage({ message: "Invalid preset name." })).toBe("Invalid preset name.");
    expect(errorMessage({ message: "x", code: 3 })).toBe("x");
  });

  it("reads Error instances", async () => {
    const errorMessage = await load();
    expect(errorMessage(new Error("kaboom"))).toBe("kaboom");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a boolean", true],
    ["an empty object", {}],
    ["a non-string message", { message: 42 }],
    ["a null message", { message: null }],
    ["an array", ["oops"]],
    ["a function", () => "oops"],
  ])("falls back to a generic message for %s", async (_, junk) => {
    const errorMessage = await load();
    expect(errorMessage(junk)).toBe(FALLBACK);
  });
});

describe("real bridge: error events go through errorMessage", () => {
  it("delivers the message from a { message } payload", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();
    const errors: string[] = [];
    bridge.subscribeError((m) => errors.push(m));
    emit("error", { message: "Couldn't load 'amp.nam'" });
    emit("error", { nope: true });
    emit("error", null);
    expect(errors).toEqual([
      "Couldn't load 'amp.nam'",
      "Something went wrong in the audio engine.",
      "Something went wrong in the audio engine.",
    ]);
  });

  it("fans out to every error subscriber and stops after unsubscribe", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();
    const a: string[] = [];
    const b: string[] = [];
    const unsubA = bridge.subscribeError((m) => a.push(m));
    bridge.subscribeError((m) => b.push(m));
    emit("error", { message: "one" });
    unsubA();
    emit("error", { message: "two" });
    expect(a).toEqual(["one"]);
    expect(b).toEqual(["one", "two"]);
  });

  it("reports an unreachable engine (getState rejects) on the error channel", async () => {
    installBackend();
    getStateMock.mockRejectedValue(new Error("timeout"));
    const { bridge } = await importBridge();
    const errors: string[] = [];
    bridge.subscribeError((m) => errors.push(m));
    const states: EngineState[] = [];
    bridge.subscribe((s) => states.push(s));
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBe("The audio engine didn’t answer (Error: timeout). Click Retry. If that doesn’t help, quit Tonebench and open it again.");
    expect(states).toHaveLength(0);
  });
});

describe("real bridge: initial state + native calls", () => {
  // getNativeFunctionMock hands out one vi.fn per name; find the one for `name`.
  function native(name: string) {
    const i = getNativeFunctionMock.mock.calls.findIndex(([n]) => n === name);
    return getNativeFunctionMock.mock.results[i].value as ReturnType<typeof vi.fn>;
  }

  it("a subscriber before any state event gets the state fetched via getState()", async () => {
    installBackend();
    getStateMock.mockResolvedValue(makeState({ device: "Fetched" }));
    const { bridge } = await importBridge();
    const seen: EngineState[] = [];
    bridge.subscribe((s) => seen.push(s));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].device).toBe("Fetched");
  });

  it("getState() caches the result for later subscribers", async () => {
    installBackend();
    getStateMock.mockResolvedValue(makeState({ device: "Cached" }));
    const { bridge } = await importBridge();
    expect((await bridge.getState()).device).toBe("Cached");
    const seen: EngineState[] = [];
    bridge.subscribe((s) => seen.push(s));
    expect(seen.map((s) => s.device)).toEqual(["Cached"]); // synchronous replay
  });

  it("forwards each action to its native function with the right arguments", async () => {
    installBackend();
    const { bridge } = await importBridge();
    bridge.loadSlot("nam");
    bridge.loadPlugin("/VST3/BYOD.vst3");
    void bridge.listPlugins();
    bridge.clearSlot("ir");
    bridge.setBypass("vst3", true);
    bridge.setMix("ir", 0.25);
    bridge.setGain("nam", 0.75);
    bridge.setInput(0.1);
    bridge.setMaster(0.9);
    bridge.setMonitor(false);
    bridge.setGate(0.4);
    bridge.setTuner(true);
    bridge.openEditor();
    bridge.savePreset("My Rig");
    bridge.loadPreset("Other Rig");
    bridge.playTestSound();
    bridge.finishSetup();
    bridge.openUrl("https://example.com/");
    void bridge.getAudioSetup();
    void bridge.setAudioSetup({ input: 1 });
    expect(native("loadSlot")).toHaveBeenCalledExactlyOnceWith("nam");
    expect(native("loadPlugin")).toHaveBeenCalledExactlyOnceWith("/VST3/BYOD.vst3");
    expect(native("listPlugins")).toHaveBeenCalledExactlyOnceWith();
    expect(native("clearSlot")).toHaveBeenCalledExactlyOnceWith("ir");
    expect(native("setBypass")).toHaveBeenCalledExactlyOnceWith("vst3", true);
    expect(native("setMix")).toHaveBeenCalledExactlyOnceWith("ir", 0.25);
    expect(native("setGain")).toHaveBeenCalledExactlyOnceWith("nam", 0.75);
    expect(native("setInput")).toHaveBeenCalledExactlyOnceWith(0.1);
    expect(native("setMaster")).toHaveBeenCalledExactlyOnceWith(0.9);
    expect(native("setMonitor")).toHaveBeenCalledExactlyOnceWith(false);
    expect(native("setGate")).toHaveBeenCalledExactlyOnceWith(0.4);
    expect(native("setTuner")).toHaveBeenCalledExactlyOnceWith(true);
    expect(native("openEditor")).toHaveBeenCalledExactlyOnceWith();
    expect(native("playTestSound")).toHaveBeenCalledExactlyOnceWith();
    // No argument means "and start monitoring", sent explicitly.
    expect(native("finishSetup")).toHaveBeenCalledExactlyOnceWith(true);
    expect(native("openUrl")).toHaveBeenCalledExactlyOnceWith("https://example.com/");
    expect(native("getAudioSetup")).toHaveBeenCalledExactlyOnceWith();
    expect(native("setAudioSetup")).toHaveBeenCalledExactlyOnceWith({ input: 1 });
    expect(native("savePreset")).toHaveBeenCalledExactlyOnceWith("My Rig");
    expect(native("loadPreset")).toHaveBeenCalledExactlyOnceWith("Other Rig");
  });

  it("finishSetup passes startMonitoring through", async () => {
    installBackend();
    const { bridge } = await importBridge();
    bridge.finishSetup(false);
    bridge.finishSetup(true);
    expect(native("finishSetup").mock.calls).toEqual([[false], [true]]);
  });

  it("scope subscriptions receive sample batches and unsubscribe by token", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();
    const batches: number[][] = [];
    const unsub = bridge.subscribeScope((s) => batches.push(s));
    emit("scope", [0.1, -0.2]);
    expect(batches).toEqual([[0.1, -0.2]]);
    unsub();
    const backend = (globalThis as JuceWin).__JUCE__!.backend as { removeEventListener: ReturnType<typeof vi.fn> };
    expect(backend.removeEventListener).toHaveBeenCalledTimes(1);
  });
});

describe("mock engine behaviour", () => {
  async function mockBridge() {
    delete (globalThis as JuceWin).__JUCE__;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { bridge } = await importBridge();
    const states: EngineState[] = [];
    bridge.subscribe((s) => states.push(s));
    return { bridge, last: () => states[states.length - 1], states };
  }
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("delivers the current state synchronously on subscribe", async () => {
    const { states } = await mockBridge();
    expect(states).toHaveLength(1);
    expect(states[0].activePreset).toBe("Hiwatt Lead");
  });

  it("loadSlot cycles NAM and IR names and resets their trims", async () => {
    const { bridge, last } = await mockBridge();
    bridge.setGain("nam", 0.9);
    bridge.loadSlot("nam");
    expect(last().slots.nam).toMatchObject({ loaded: true, name: "Fig HW DR Hot 212", gain: 0.5 });
    bridge.setMix("ir", 0.3);
    bridge.loadSlot("ir");
    expect(last().slots.ir).toMatchObject({ loaded: true, name: "Hiwatt SE4123 R121", mix: 1 });
    bridge.loadSlot("vst3");
    expect(last().slots.vst3).toMatchObject({ loaded: true, name: "SICO High Gain" });
  });

  it("clearSlot empties a slot", async () => {
    const { bridge, last } = await mockBridge();
    bridge.clearSlot("nam");
    expect(last().slots.nam).toMatchObject({ loaded: false, name: "" });
  });

  it("setBypass / setInput / setMaster / setMonitor update state", async () => {
    const { bridge, last } = await mockBridge();
    bridge.setBypass("ir", true);
    bridge.setInput(0.3);
    bridge.setMaster(0.4);
    bridge.setMonitor(false);
    expect(last().slots.ir.bypassed).toBe(true);
    expect(last()).toMatchObject({ inputGain: 0.3, masterGain: 0.4, monitoring: false, playing: false });
  });

  it("savePreset adds a new name once and makes it active; loadPreset activates", async () => {
    const { bridge, last } = await mockBridge();
    bridge.savePreset("New One");
    bridge.savePreset("New One");
    expect(last().presets.filter((p) => p === "New One")).toHaveLength(1);
    expect(last().activePreset).toBe("New One");
    bridge.loadPreset("Page Crunch");
    expect(last().activePreset).toBe("Page Crunch");
  });

  it("ticks meters every 50 ms, silent when muted", async () => {
    const { bridge, last, states } = await mockBridge();
    vi.advanceTimersByTime(50);
    expect(states).toHaveLength(2);
    expect(last().inputLevel).toBeGreaterThan(0);
    bridge.setMonitor(false);
    vi.advanceTimersByTime(50);
    expect(last().inputLevel).toBe(0);
    expect(last().outputLevel).toBe(0);
  });

  it("streams scope batches of 48 samples only while someone listens", async () => {
    const { bridge } = await mockBridge();
    const batches: number[][] = [];
    const unsub = bridge.subscribeScope((s) => batches.push(s));
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(48);
    unsub();
    vi.advanceTimersByTime(100);
    expect(batches).toHaveLength(2);
  });

  it("never emits errors (no-op channel) but supports unsubscribe", async () => {
    const { bridge } = await mockBridge();
    const cb = vi.fn();
    const unsub = bridge.subscribeError(cb);
    vi.advanceTimersByTime(500);
    unsub();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("real bridge: input peaks (setup's per-input levels)", () => {
  it("passes the meters event's inputPeaks to peak subscribers, not into the state", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();
    emit("state", makeState());
    const states: EngineState[] = [];
    bridge.subscribe((s) => states.push(s));
    const peaks: number[][] = [];
    const unsub = bridge.subscribeInputPeaks((p) => peaks.push(p));

    emit("meters", { inputLevel: 0.3, outputLevel: 0.2, playing: true, inputPeaks: [0.01, 0.6] });
    expect(peaks).toEqual([[0.01, 0.6]]);
    const last = states[states.length - 1];
    expect(last.inputLevel).toBe(0.3);
    expect(last.outputLevel).toBe(0.2);
    expect(last).not.toHaveProperty("inputPeaks");

    unsub();
    emit("meters", { inputLevel: 0.1, inputPeaks: [0.9] });
    expect(peaks).toHaveLength(1);
    expect(states[states.length - 1]).not.toHaveProperty("inputPeaks");
  });

  it("delivers peaks even before the first state arrives", async () => {
    const { emit } = installBackend();
    getStateMock.mockReturnValue(new Promise<EngineState>(() => {}));
    const { bridge } = await importBridge();
    const peaks: number[][] = [];
    bridge.subscribeInputPeaks((p) => peaks.push(p));
    emit("meters", { inputLevel: 0.5, inputPeaks: [0.4] });
    expect(peaks).toEqual([[0.4]]);
  });

  it("passes the meters event's tuner reading to tuner subscribers, not into the state", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();
    const states: EngineState[] = [];
    bridge.subscribe((s) => states.push(s));
    emit("state", makeState());
    const readings: unknown[] = [];
    const off = bridge.subscribeTuner((r) => readings.push(r));

    emit("meters", { inputLevel: 0.2, tuner: { note: "E", octave: 2, cents: -4, hz: 82.2 } });
    emit("meters", { inputLevel: 0.2, tuner: null });
    emit("meters", { inputLevel: 0.2 });   // tuner off: no key at all, nothing sent
    expect(readings).toEqual([{ note: "E", octave: 2, cents: -4, hz: 82.2 }, null]);
    expect(states[states.length - 1]).not.toHaveProperty("tuner");

    off();
    emit("meters", { tuner: { note: "A", octave: 2, cents: 0, hz: 110 } });
    expect(readings).toHaveLength(2);
  });

  it("meters without inputPeaks don't call peak subscribers; an empty list is passed on", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();
    emit("state", makeState());
    const cb = vi.fn();
    bridge.subscribeInputPeaks(cb);
    emit("meters", { inputLevel: 0.5 });
    expect(cb).not.toHaveBeenCalled();
    emit("meters", { inputLevel: 0.5, inputPeaks: [] });
    expect(cb).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("fans out to every peak subscriber", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();
    const a = vi.fn();
    const b = vi.fn();
    bridge.subscribeInputPeaks(a);
    bridge.subscribeInputPeaks(b);
    emit("meters", { inputPeaks: [0.2, 0.3] });
    expect(a).toHaveBeenCalledExactlyOnceWith([0.2, 0.3]);
    expect(b).toHaveBeenCalledExactlyOnceWith([0.2, 0.3]);
  });
});

describe("real bridge: showSettings (the native menu's Settings…)", () => {
  it("calls subscribers on the showSettings event and detaches by token", async () => {
    const { emit } = installBackend();
    const { bridge } = await importBridge();
    const cb = vi.fn();
    const unsub = bridge.subscribeShowSettings(cb);
    emit("showSettings", undefined);
    emit("showSettings", {});
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1); // called with no payload
    unsub();
    const backend = (globalThis as JuceWin).__JUCE__!.backend as { removeEventListener: ReturnType<typeof vi.fn> };
    expect(backend.removeEventListener).toHaveBeenCalledTimes(1);
  });
});

describe("real bridge: audio setup calls", () => {
  it("setAudioSetup/getAudioSetup resolve to what the engine returns", async () => {
    installBackend();
    const { bridge } = await importBridge();
    const i = (name: string) => getNativeFunctionMock.mock.calls.findIndex(([n]) => n === name);
    const engineSetup = { inputDevice: "Apollo", error: "" };
    (getNativeFunctionMock.mock.results[i("getAudioSetup")].value as ReturnType<typeof vi.fn>).mockResolvedValue(engineSetup);
    (getNativeFunctionMock.mock.results[i("setAudioSetup")].value as ReturnType<typeof vi.fn>).mockResolvedValue({ ...engineSetup, error: "nope" });
    expect(await bridge.getAudioSetup()).toEqual(engineSetup);
    expect((await bridge.setAudioSetup({ bufferSize: 64 })).error).toBe("nope");
  });
});

describe("mock engine: pretend devices and first-run setup", () => {
  async function mockBridge(search = "") {
    delete (globalThis as JuceWin).__JUCE__;
    window.history.replaceState(null, "", `/${search}`);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { bridge } = await importBridge();
    const states: EngineState[] = [];
    bridge.subscribe((s) => states.push(s));
    return { bridge, last: () => states[states.length - 1] };
  }
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("normally starts set up: the Scarlett with the guitar on Input 2, monitoring on", async () => {
    const { bridge, last } = await mockBridge();
    expect(last()).toMatchObject({ setupComplete: true, monitoring: true });
    const audio = await bridge.getAudioSetup();
    expect(audio).toMatchObject({
      inputDevice: "Scarlett 2i2 USB",
      outputDevice: "Scarlett 2i2 USB",
      inputDevices: ["MacBook Pro Microphone", "Scarlett 2i2 USB"],
      inputs: ["Input 1", "Input 2"],
      input: 1,
      listeningToAll: false,
      builtInInput: false,
      sampleRate: 48000,
      bufferSize: 128,
      error: "",
    });
    expect(audio.latencyMs).toBeCloseTo(((2 * 128) / 48000) * 1000 + 1.4, 6);
    expect(audio.bufferSizes).toContain(256);
  });

  it("?setup starts as a fresh install: setup not done, muted, on the laptop mic", async () => {
    const { bridge, last } = await mockBridge("?setup");
    expect(last()).toMatchObject({ setupComplete: false, monitoring: false });
    expect(await bridge.getAudioSetup()).toMatchObject({
      inputDevice: "MacBook Pro Microphone",
      outputDevice: "MacBook Pro Speakers",
      inputs: ["Microphone"],
      input: 0,
      builtInInput: true,
    });
  });

  it("getAudioSetup returns a copy (callers can't mutate the engine)", async () => {
    const { bridge } = await mockBridge();
    const a = await bridge.getAudioSetup();
    a.inputDevice = "hacked";
    expect((await bridge.getAudioSetup()).inputDevice).toBe("Scarlett 2i2 USB");
  });

  it("setAudioSetup switches device (first input), and the top-bar state follows", async () => {
    const { bridge, last } = await mockBridge("?setup");
    const next = await bridge.setAudioSetup({ inputDevice: "Scarlett 2i2 USB", outputDevice: "Scarlett 2i2 USB" });
    expect(next).toMatchObject({ inputDevice: "Scarlett 2i2 USB", outputDevice: "Scarlett 2i2 USB", inputs: ["Input 1", "Input 2"], input: 0, builtInInput: false });
    expect(last().device).toBe("Scarlett 2i2 USB");
  });

  it("buffer size and sample rate changes update latency and the state", async () => {
    const { bridge, last } = await mockBridge();
    const a = await bridge.setAudioSetup({ bufferSize: 256 });
    expect(a.bufferSize).toBe(256);
    expect(a.latencyMs).toBeCloseTo(((2 * 256) / 48000) * 1000 + 1.4, 6);
    expect(last()).toMatchObject({ bufferSize: 256, sampleRate: 48000 });
    expect(last().roundTripMs).toBeCloseTo(a.latencyMs, 6);
    const b = await bridge.setAudioSetup({ sampleRate: 96000 });
    expect(last()).toMatchObject({ sampleRate: 96000, bufferSize: 256 });
    expect(b.latencyMs).toBeCloseTo(((2 * 256) / 96000) * 1000 + 1.4, 6);
  });

  it("listenToAllInputs opens every input (input -1); choosing one closes the rest", async () => {
    const { bridge } = await mockBridge();
    expect(await bridge.setAudioSetup({ listenToAllInputs: true })).toMatchObject({ listeningToAll: true, input: -1 });
    expect(await bridge.setAudioSetup({ input: 1 })).toMatchObject({ listeningToAll: false, input: 1 });
  });

  it("emits per-input peaks: every input while listening to all, the guitar loudest", async () => {
    const { bridge } = await mockBridge();
    await bridge.setAudioSetup({ listenToAllInputs: true });
    const peaks: number[][] = [];
    const unsub = bridge.subscribeInputPeaks((p) => peaks.push(p));
    vi.advanceTimersByTime(50);
    expect(peaks).toHaveLength(1);
    const [hiss, guitar] = peaks[0];
    expect(peaks[0]).toHaveLength(2);
    expect(hiss).toBeLessThan(0.05);
    expect(guitar).toBeGreaterThan(0.05);
    unsub();
    vi.advanceTimersByTime(100);
    expect(peaks).toHaveLength(1);
  });

  it("emits just the selected input's peak otherwise", async () => {
    const { bridge } = await mockBridge();
    const peaks: number[][] = [];
    bridge.subscribeInputPeaks((p) => peaks.push(p));
    vi.advanceTimersByTime(50);
    expect(peaks.at(-1)).toHaveLength(1);
    expect(peaks.at(-1)![0]).toBeGreaterThan(0.05); // Input 2: the guitar
    await bridge.setAudioSetup({ input: 0 });
    vi.advanceTimersByTime(50);
    expect(peaks.at(-1)).toEqual([0.004]); // Input 1: hiss
  });

  it("the laptop mic never hears the guitar", async () => {
    const { bridge } = await mockBridge("?setup");
    await bridge.setAudioSetup({ listenToAllInputs: true });
    const peaks: number[][] = [];
    bridge.subscribeInputPeaks((p) => peaks.push(p));
    vi.advanceTimersByTime(500);
    expect(peaks.flat().every((p) => p === 0.004)).toBe(true);
  });

  it("an input past the device's last one falls back to the first", async () => {
    const { bridge } = await mockBridge("?setup"); // the laptop mic: one input
    expect(await bridge.setAudioSetup({ input: 1 })).toMatchObject({ input: 0, inputs: ["Microphone"] });
  });

  it("a device it doesn't know has no inputs, and only hiss", async () => {
    const { bridge } = await mockBridge();
    expect(await bridge.setAudioSetup({ inputDevice: "Unplugged Thing" })).toMatchObject({ inputs: [], input: 0, builtInInput: false });
    const peaks: number[][] = [];
    bridge.subscribeInputPeaks((p) => peaks.push(p));
    vi.advanceTimersByTime(50);
    expect(peaks).toEqual([[0.004]]);
    expect(await bridge.setAudioSetup({ listenToAllInputs: true })).toMatchObject({ listeningToAll: true, input: -1 });
    vi.advanceTimersByTime(50);
    expect(peaks.at(-1)).toEqual([]);
  });

  it("finishSetup turns setup-complete and monitoring on", async () => {
    const { bridge, last } = await mockBridge("?setup");
    bridge.finishSetup();
    expect(last()).toMatchObject({ setupComplete: true, monitoring: true, playing: true });
  });

  it("finishSetup(false) completes setup but leaves monitoring off", async () => {
    const { bridge, last } = await mockBridge("?setup");
    expect(last()).toMatchObject({ setupComplete: false, monitoring: false });
    bridge.finishSetup(false);
    expect(last()).toMatchObject({ setupComplete: true, monitoring: false });
  });

  it("openUrl opens a new window without an opener", async () => {
    const { bridge } = await mockBridge();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    bridge.openUrl("https://www.tone3000.com/");
    expect(open).toHaveBeenCalledExactlyOnceWith("https://www.tone3000.com/", "_blank", "noopener");
  });

  it("playTestSound is a harmless no-op; showSettings never fires on its own", async () => {
    const { bridge } = await mockBridge();
    const cb = vi.fn();
    const unsub = bridge.subscribeShowSettings(cb);
    expect(() => bridge.playTestSound()).not.toThrow();
    vi.advanceTimersByTime(500);
    unsub();
    expect(cb).not.toHaveBeenCalled();
  });
});
