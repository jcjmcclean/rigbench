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
