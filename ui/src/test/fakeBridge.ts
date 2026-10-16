// A controllable stand-in for `bridge` (src/bridge.ts) for component tests.
//
// Component tests do `vi.mock("../bridge", () => import("../test/bridgeModuleMock"))`
// and import `fake` from here: the mocked module and the test share this one
// singleton, so tests can assert calls (`fake.bridge.setMonitor`) and push
// engine events (`fake.emitState`, `fake.emitError`, `fake.emitScope`).
// Call `fake.reset()` in `beforeEach`.
import { vi } from "vitest";
import type { AudioSetup, Bridge, EngineState } from "../types";

export function makeAudioSetup(over: Partial<AudioSetup> = {}): AudioSetup {
  return {
    driver: "CoreAudio",
    drivers: ["CoreAudio"],
    inputDevice: "Test Interface",
    inputDevices: ["Built-in Microphone", "Test Interface"],
    outputDevice: "Test Interface",
    outputDevices: ["Built-in Output", "Test Interface"],
    inputs: ["Input 1", "Input 2"],
    input: 0,
    listeningToAll: false,
    sampleRate: 48000,
    sampleRates: [44100, 48000],
    bufferSize: 128,
    bufferSizes: [64, 128, 256],
    latencyMs: 6.8,
    builtInInput: false,
    error: "",
    ...over,
  };
}

export function makeState(over: Partial<EngineState> = {}): EngineState {
  return {
    device: "Test Interface",
    sampleRate: 48000,
    bufferSize: 128,
    roundTripMs: 7.4,
    setupComplete: true,
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
  const peakSubs = new Set<(p: number[]) => void>();
  const showSettingsSubs = new Set<() => void>();
  let current: EngineState | null = null;
  let audio = makeAudioSetup();

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
    subscribeInputPeaks: vi.fn((cb: (p: number[]) => void) => {
      peakSubs.add(cb);
      return () => { peakSubs.delete(cb); };
    }),
    subscribeShowSettings: vi.fn((cb: () => void) => {
      showSettingsSubs.add(cb);
      return () => { showSettingsSubs.delete(cb); };
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
    savePreset: vi.fn(),
    loadPreset: vi.fn(),
    // Applies the changes to a fake setup, the way the engine would.
    getAudioSetup: vi.fn(async () => ({ ...audio })),
    setAudioSetup: vi.fn(async (c: Parameters<Bridge["setAudioSetup"]>[0]) => {
      audio = {
        ...audio,
        ...(c.inputDevice !== undefined ? { inputDevice: c.inputDevice } : {}),
        ...(c.outputDevice !== undefined ? { outputDevice: c.outputDevice } : {}),
        ...(c.driver !== undefined ? { driver: c.driver } : {}),
        ...(c.sampleRate !== undefined ? { sampleRate: c.sampleRate } : {}),
        ...(c.bufferSize !== undefined ? { bufferSize: c.bufferSize } : {}),
        ...(c.input !== undefined ? { input: c.input } : {}),
        listeningToAll: !!c.listenToAllInputs,
        ...(c.listenToAllInputs ? { input: -1 } : {}),
      };
      return { ...audio };
    }),
    playTestSound: vi.fn(),
    finishSetup: vi.fn(),
    openUrl: vi.fn(),
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
    emitInputPeaks(peaks: number[]) {
      peakSubs.forEach((cb) => cb(peaks));
    },
    emitShowSettings() {
      showSettingsSubs.forEach((cb) => cb());
    },
    /** Replace the fake audio setup the next getAudioSetup() returns. */
    setAudio(over: Partial<AudioSetup>) {
      audio = makeAudioSetup(over);
    },
    reset() {
      current = null;
      audio = makeAudioSetup();
      subs.clear();
      errSubs.clear();
      scopeSubs.clear();
      peakSubs.clear();
      showSettingsSubs.clear();
      Object.values(bridge).forEach((f) => f.mockClear());
    },
  };
}

export const fake = createFakeBridge();
