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
    expect(errors[0]).toBe("Couldn't reach the audio engine: Error: timeout");
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
    bridge.clearSlot("ir");
    bridge.setBypass("vst3", true);
    bridge.setMix("ir", 0.25);
    bridge.setGain("nam", 0.75);
    bridge.setInput(0.1);
    bridge.setMaster(0.9);
    bridge.setMonitor(false);
    bridge.openEditor();
    bridge.savePreset("My Rig");
    bridge.loadPreset("Other Rig");
    bridge.playTestSound();
    bridge.finishSetup();
    bridge.openUrl("https://example.com/");
    void bridge.getAudioSetup();
    void bridge.setAudioSetup({ input: 1 });
    expect(native("loadSlot")).toHaveBeenCalledExactlyOnceWith("nam");
    expect(native("clearSlot")).toHaveBeenCalledExactlyOnceWith("ir");
    expect(native("setBypass")).toHaveBeenCalledExactlyOnceWith("vst3", true);
    expect(native("setMix")).toHaveBeenCalledExactlyOnceWith("ir", 0.25);
    expect(native("setGain")).toHaveBeenCalledExactlyOnceWith("nam", 0.75);
    expect(native("setInput")).toHaveBeenCalledExactlyOnceWith(0.1);
    expect(native("setMaster")).toHaveBeenCalledExactlyOnceWith(0.9);
    expect(native("setMonitor")).toHaveBeenCalledExactlyOnceWith(false);
    expect(native("openEditor")).toHaveBeenCalledExactlyOnceWith();
    expect(native("playTestSound")).toHaveBeenCalledExactlyOnceWith();
    expect(native("finishSetup")).toHaveBeenCalledExactlyOnceWith();
    expect(native("openUrl")).toHaveBeenCalledExactlyOnceWith("https://example.com/");
    expect(native("getAudioSetup")).toHaveBeenCalledExactlyOnceWith();
    expect(native("setAudioSetup")).toHaveBeenCalledExactlyOnceWith({ input: 1 });
    expect(native("savePreset")).toHaveBeenCalledExactlyOnceWith("My Rig");
    expect(native("loadPreset")).toHaveBeenCalledExactlyOnceWith("Other Rig");
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
    expect(last().slots.ir).toMatchObject({ loaded: true, name: "Hiwatt SE4123 — R121", mix: 1 });
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
