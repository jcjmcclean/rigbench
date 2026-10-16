import * as Juce from "juce-framework-frontend";
import type { Bridge, EngineState, SlotType } from "./types";

// ---------------------------------------------------------------------------
// The real engine exposes native functions + state/meter events through JUCE's
// WebView bridge. In a plain browser a mock drives the UI for development.
//
// NB: importing juce-framework-frontend installs a placeholder window.__JUCE__
// WITHOUT a `backend`, so we detect the real native integration via `.backend`.
// ---------------------------------------------------------------------------

type JuceWindow = Window & { __JUCE__?: { backend?: { addEventListener: (id: string, cb: (v: unknown) => void) => number } } };

function hasRealJuce(): boolean {
  if (typeof window === "undefined") return false;
  const j = (window as JuceWindow).__JUCE__;
  return !!j && !!j.backend;
}

// ---- Mock engine ----------------------------------------------------------
function createMockBridge(): Bridge {
  const names: Record<SlotType, string[]> = {
    vst3: ["SICO High Gain"],
    nam: ["Fig HW C50 MG 412", "Fig HW DR Hot 212", "Fig HW C50 MG DI"],
    ir: ["Mesa 4x12 — SM57", "Hiwatt SE4123 — R121", "Marshall 1960 — 414"],
  };
  let namIdx = 0;
  let irIdx = 0;

  const state: EngineState = {
    device: "Universal Audio Apollo",
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
      nam: { type: "nam", loaded: true, name: "Fig HW C50 MG 412", bypassed: false, gain: 0.5 },
      ir: { type: "ir", loaded: true, name: "Mesa 4x12 — SM57", bypassed: false, mix: 1 },
    },
    presets: ["Gilmour Clean", "Page Crunch", "Hiwatt Lead", "Bedroom Low-Volume"],
    activePreset: "Hiwatt Lead",
  };

  const subs = new Set<(s: EngineState) => void>();
  const emit = () => subs.forEach((cb) => cb({ ...state, slots: { ...state.slots } }));

  // Animate meters so the UI feels alive. A slow "playing" cycle with a
  // strummed envelope; levels only reach the output meter through un-bypassed slots.
  let t = 0;
  setInterval(() => {
    t += 0.05;
    const anyLoaded = Object.values(state.slots).some((s) => s.loaded && !s.bypassed);
    // strum envelope ~ every 2.2s
    const phase = (t % 2.2) / 2.2;
    const env = phase < 0.04 ? phase / 0.04 : Math.exp(-(phase - 0.04) * 3.1);
    const strum = state.playing ? Math.max(0, env) * (0.7 + 0.3 * Math.sin(t * 9)) : 0;
    state.inputLevel = Math.min(1, (strum * 0.9 + (state.playing ? 0.04 : 0)) * state.inputGain);
    const chainGain = anyLoaded ? 1.15 : 1;
    state.outputLevel = Math.min(1, state.inputLevel * chainGain * state.masterGain);
    emit();
  }, 50);

  return {
    getState: async () => ({ ...state }),
    subscribe(cb) {
      subs.add(cb);
      cb({ ...state });
      return () => subs.delete(cb);
    },
    loadSlot(type) {
      const s = state.slots[type];
      s.loaded = true;
      if (type === "nam") { s.name = names.nam[namIdx++ % names.nam.length]; s.gain = 0.5; }
      else if (type === "ir") { s.name = names.ir[irIdx++ % names.ir.length]; s.mix = 1; }
      else s.name = names.vst3[0];
      emit();
    },
    clearSlot(type) {
      const s = state.slots[type];
      s.loaded = false;
      s.name = "";
      emit();
    },
    setBypass(type, bypassed) { state.slots[type].bypassed = bypassed; emit(); },
    setMix(type, value) { state.slots[type].mix = value; emit(); },
    setGain(type, value) { state.slots[type].gain = value; emit(); },
    setInput(value) { state.inputGain = value; emit(); },
    setMaster(value) { state.masterGain = value; emit(); },
    setMonitor(on) { state.monitoring = on; state.playing = on; emit(); },
    openEditor() { /* native-only */ },
    openAudioSettings() { /* native-only */ },
    savePreset(name) {
      if (!state.presets.includes(name)) state.presets.push(name);
      state.activePreset = name;
      emit();
    },
    loadPreset(name) { state.activePreset = name; emit(); },
  };
}

// ---- Real JUCE engine -----------------------------------------------------
function createJuceBridge(): Bridge {
  const fn = (name: string) => Juce.getNativeFunction(name) as (...args: unknown[]) => Promise<unknown>;
  const f = {
    getState: fn("getState"),
    loadSlot: fn("loadSlot"),
    clearSlot: fn("clearSlot"),
    setBypass: fn("setBypass"),
    setMix: fn("setMix"),
    setGain: fn("setGain"),
    setInput: fn("setInput"),
    setMaster: fn("setMaster"),
    setMonitor: fn("setMonitor"),
    openEditor: fn("openEditor"),
    openAudioSettings: fn("openAudioSettings"),
    savePreset: fn("savePreset"),
    loadPreset: fn("loadPreset"),
  };

  let current: EngineState | null = null;
  const subs = new Set<(s: EngineState) => void>();
  const notify = () => { if (current) subs.forEach((cb) => cb(current as EngineState)); };

  const backend = (window as unknown as {
    __JUCE__: { backend: { addEventListener: (id: string, cb: (v: unknown) => void) => number } };
  }).__JUCE__.backend;

  backend.addEventListener("state", (s: unknown) => { current = s as EngineState; notify(); });
  backend.addEventListener("meters", (m: unknown) => {
    if (current) { current = { ...current, ...(m as Partial<EngineState>) }; notify(); }
  });

  return {
    getState: async () => { current = (await f.getState()) as EngineState; return current; },
    subscribe(cb) {
      subs.add(cb);
      if (current) cb(current);
      else void f.getState().then((s) => { current = s as EngineState; cb(current); });
      return () => { subs.delete(cb); };
    },
    loadSlot: (t) => void f.loadSlot(t),
    clearSlot: (t) => void f.clearSlot(t),
    setBypass: (t, b) => void f.setBypass(t, b),
    setMix: (t, v) => void f.setMix(t, v),
    setGain: (t, v) => void f.setGain(t, v),
    setInput: (v) => void f.setInput(v),
    setMaster: (v) => void f.setMaster(v),
    setMonitor: (b) => void f.setMonitor(b),
    openEditor: () => void f.openEditor(),
    openAudioSettings: () => void f.openAudioSettings(),
    savePreset: (n) => void f.savePreset(n),
    loadPreset: (n) => void f.loadPreset(n),
  };
}

export const isMock = !hasRealJuce();
export const bridge: Bridge = hasRealJuce() ? createJuceBridge() : createMockBridge();
