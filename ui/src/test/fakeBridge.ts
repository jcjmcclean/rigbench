// A controllable stand-in for `bridge` (src/bridge.ts) for component tests.
//
// Component tests do `vi.mock("../bridge", () => import("../test/bridgeModuleMock"))`
// and import `fake` from here: the mocked module and the test share this one
// singleton, so tests can assert calls (`fake.bridge.setMonitor`) and push
// engine events (`fake.emitState`, `fake.emitError`, `fake.emitScope`).
// Call `fake.reset()` in `beforeEach`.
import { vi } from "vitest";
import type { Bridge, EngineState } from "../types";

export function makeState(over: Partial<EngineState> = {}): EngineState {
  return {
    device: "Test Interface",
    sampleRate: 48000,
    bufferSize: 128,
    roundTripMs: 7.4,
    monitoring: true,
    inputGain: 0.8,
    masterGain: 0.8,
    playing: true,
    inputLevel: 0,
    outputLevel: 0,
    slots: {
      vst3: { type: "vst3", loaded: false, name: "", bypassed: false, hasEditor: true },
      nam: { type: "nam", loaded: true, name: "Amp Model A", bypassed: false, gain: 0.5 },
      ir: { type: "ir", loaded: true, name: "Cab IR A", bypassed: false, mix: 1 },
    },
    presets: ["Clean", "Crunch", "Lead"],
    activePreset: "Crunch",
    ...over,
  };
}

export function createFakeBridge() {
  const subs = new Set<(s: EngineState) => void>();
  const errSubs = new Set<(m: string) => void>();
  const scopeSubs = new Set<(s: number[]) => void>();
  let current: EngineState | null = null;

  const bridge = {
    getState: vi.fn(async () => current as EngineState),
    subscribe: vi.fn((cb: (s: EngineState) => void) => {
      subs.add(cb);
      if (current) cb(current);
      return () => { subs.delete(cb); };
    }),
    subscribeScope: vi.fn((cb: (s: number[]) => void) => {
      scopeSubs.add(cb);
      return () => { scopeSubs.delete(cb); };
    }),
    subscribeError: vi.fn((cb: (m: string) => void) => {
      errSubs.add(cb);
      return () => { errSubs.delete(cb); };
    }),
    loadSlot: vi.fn(),
    clearSlot: vi.fn(),
    setBypass: vi.fn(),
    setMix: vi.fn(),
    setGain: vi.fn(),
    setInput: vi.fn(),
    setMaster: vi.fn(),
    setMonitor: vi.fn(),
    openEditor: vi.fn(),
    openAudioSettings: vi.fn(),
    savePreset: vi.fn(),
    loadPreset: vi.fn(),
  } satisfies Bridge;

  return {
    bridge,
    /** Number of live subscribers per channel (to check unsubscribe on unmount). */
    counts: () => ({ state: subs.size, error: errSubs.size, scope: scopeSubs.size }),
    emitState(s: EngineState) {
      current = s;
      subs.forEach((cb) => cb(s));
    },
    emitError(m: string) {
      errSubs.forEach((cb) => cb(m));
    },
    emitScope(pts: number[]) {
      scopeSubs.forEach((cb) => cb(pts));
    },
    reset() {
      current = null;
      subs.clear();
      errSubs.clear();
      scopeSubs.clear();
      Object.values(bridge).forEach((f) => f.mockClear());
    },
  };
}

export const fake = createFakeBridge();
