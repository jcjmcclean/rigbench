// MUST precede the juce-framework-frontend import: that import installs a
// placeholder window.__JUCE__ (with a stub backend), so juceDetect records the
// real state first (it imports nothing).
import { hasRealJuceBackend } from "./juceDetect";
import * as Juce from "juce-framework-frontend";
import type { AudioSetup, AudioSetupChanges, Bridge, EngineState, SlotType, TunerReading } from "./types";

// ---------------------------------------------------------------------------
// The real engine exposes native functions + state/meter events through JUCE's
// WebView bridge. In a plain browser a mock drives the UI for development.
// ---------------------------------------------------------------------------

// ---- Mock engine ----------------------------------------------------------
function createMockBridge(): Bridge {
  const names: Record<SlotType, string[]> = {
    vst3: ["SICO High Gain"],
    nam: ["Fig HW C50 MG 412", "Fig HW DR Hot 212", "Fig HW C50 MG DI"],
    ir: ["Mesa 4x12 — SM57", "Hiwatt SE4123 — R121", "Marshall 1960 — 414"],
  };
  // The NAM and IR slots start loaded with the first name, so "Change" moves on from it.
  let namIdx = 1;
  let irIdx = 1;

  // `?setup` in the URL starts as a fresh install, so first-run setup shows
  // (for the e2e tests and for working on it in the browser).
  const freshInstall = typeof location !== "undefined" && new URLSearchParams(location.search).has("setup");

  // Pretend devices: the laptop's own mic and speakers, and a two-input
  // interface with the guitar on input 2.
  const devices: Record<string, { inputs: string[]; guitarOn: number }> = {
    "MacBook Pro Microphone": { inputs: ["Microphone"], guitarOn: -1 },
    "Scarlett 2i2 USB": { inputs: ["Input 1", "Input 2"], guitarOn: 1 },
  };
  const audio: AudioSetup = {
    driver: "CoreAudio",
    drivers: ["CoreAudio"],
    inputDevice: freshInstall ? "MacBook Pro Microphone" : "Scarlett 2i2 USB",
    inputDevices: Object.keys(devices),
    outputDevice: freshInstall ? "MacBook Pro Speakers" : "Scarlett 2i2 USB",
    outputDevices: ["MacBook Pro Speakers", "Scarlett 2i2 USB"],
    inputs: [],
    input: 0,
    listeningToAll: false,
    sampleRate: 48000,
    sampleRates: [44100, 48000, 96000],
    bufferSize: 128,
    bufferSizes: [32, 64, 128, 256, 512, 1024],
    latencyMs: 0,
    builtInInput: false,
    error: "",
  };
  const syncAudio = () => {
    audio.inputs = devices[audio.inputDevice]?.inputs ?? [];
    audio.builtInInput = audio.inputDevice.startsWith("MacBook");
    if (audio.input >= audio.inputs.length) audio.input = 0;
    audio.latencyMs = (2 * audio.bufferSize) / audio.sampleRate * 1000 + 1.4;
  };
  if (!freshInstall) audio.input = 1;
  syncAudio();

  const state: EngineState = {
    device: "Universal Audio Apollo",
    sampleRate: 48000,
    bufferSize: 128,
    roundTripMs: 7.4,
    setupComplete: !freshInstall,
    monitoring: !freshInstall,
    inputGain: 0.8,
    masterGain: 0.8,
    gate: 0,
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

  // No real backend in the browser, so no error events — wire a no-op channel so
  // the Bridge shape matches the JUCE engine. (A demo error could be emitted here.)
  const errSubs = new Set<(m: string) => void>();

  const scopeSubs = new Set<(s: number[]) => void>();
  let scopePhase = 0;
  const peakSubs = new Set<(p: number[]) => void>();
  const showSettingsSubs = new Set<() => void>();
  const tunerSubs = new Set<(r: TunerReading | null) => void>();
  let tuning = false;

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
    // Peak levels like a real guitar DI: about -14 dBFS on the pick, -40 between notes.
    const drive = (strum * 0.9 + (state.playing ? 0.04 : 0)) * state.inputGain;
    state.inputLevel = Math.min(1, drive * 0.25 + (state.playing ? 0.01 : 0));
    const chainGain = anyLoaded ? 1.15 : 1;
    state.outputLevel = Math.min(1, state.inputLevel * chainGain * state.masterGain);
    emit();

    // Tuner: a low E string, settling into tune as it rings, then silence.
    if (tuning && tunerSubs.size) {
      const sounding = phase < 0.75;
      const cents = Math.round(-18 * Math.exp(-phase * 4) * 10) / 10;
      tunerSubs.forEach((cb) => cb(sounding ? { note: "E", octave: 2, cents, hz: 82.41 * 2 ** (cents / 1200) } : null));
    }

    // Raw input levels: the guitar strums on its input, the others just hiss.
    if (peakSubs.size) {
      const guitar = devices[audio.inputDevice]?.guitarOn ?? -1;
      const playing = Math.max(0, env) * 0.6 + 0.01;
      const peaks = audio.listeningToAll
        ? audio.inputs.map((_, i) => (i === guitar ? playing : 0.004))
        : [audio.input === guitar ? playing : 0.004];
      peakSubs.forEach((cb) => cb(peaks));
    }

    if (scopeSubs.size) {
      // The scope is drawn on its own (compressed) scale, so feed it the strum.
      const amp = drive > 0.02 ? Math.min(1, drive * chainGain * state.masterGain) : 0; // gate on input
      const pts: number[] = [];
      for (let i = 0; i < 48; i++) {
        scopePhase += 0.42;
        // guitar-ish: fundamental + inharmonic harmonics + a little grit
        const wv =
          Math.sin(scopePhase) * 0.6 +
          Math.sin(scopePhase * 2.02) * 0.26 +
          Math.sin(scopePhase * 3.05) * 0.13 +
          (Math.random() - 0.5) * 0.07;
        const dyn = 0.7 + 0.3 * Math.sin(t * 3.1 + scopePhase * 0.04); // playing dynamics
        pts.push(wv * amp * dyn);
      }
      scopeSubs.forEach((cb) => cb(pts));
    }
  }, 50);

  return {
    getState: async () => ({ ...state }),
    subscribe(cb) {
      subs.add(cb);
      cb({ ...state });
      return () => subs.delete(cb);
    },
    subscribeScope(cb) {
      scopeSubs.add(cb);
      return () => scopeSubs.delete(cb);
    },
    subscribeError(cb) {
      errSubs.add(cb);
      return () => errSubs.delete(cb);
    },
    subscribeInputPeaks(cb) {
      peakSubs.add(cb);
      return () => peakSubs.delete(cb);
    },
    subscribeShowSettings(cb) {
      showSettingsSubs.add(cb);
      return () => showSettingsSubs.delete(cb);
    },
    subscribeTuner(cb) {
      tunerSubs.add(cb);
      return () => tunerSubs.delete(cb);
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
    setGate(value) { state.gate = value; emit(); },
    setTuner(on) { tuning = on; },
    openEditor() { /* native-only */ },
    async getAudioSetup() { return { ...audio }; },
    async setAudioSetup(c: AudioSetupChanges) {
      audio.error = "";
      if (c.inputDevice !== undefined) { audio.inputDevice = c.inputDevice; audio.input = 0; }
      if (c.outputDevice !== undefined) audio.outputDevice = c.outputDevice;
      if (c.sampleRate !== undefined) audio.sampleRate = c.sampleRate;
      if (c.bufferSize !== undefined) audio.bufferSize = c.bufferSize;
      audio.listeningToAll = !!c.listenToAllInputs;
      if (c.input !== undefined) audio.input = c.input;
      if (audio.listeningToAll) audio.input = -1;
      syncAudio();
      state.device = audio.inputDevice;
      state.sampleRate = audio.sampleRate;
      state.bufferSize = audio.bufferSize;
      state.roundTripMs = audio.latencyMs;
      emit();
      return { ...audio };
    },
    playTestSound() { /* no sound in the browser */ },
    finishSetup() { state.setupComplete = true; state.monitoring = true; state.playing = true; emit(); },
    openUrl(url) { window.open(url, "_blank", "noopener"); },
    savePreset(name) {
      if (!state.presets.includes(name)) state.presets.push(name);
      state.activePreset = name;
      emit();
    },
    loadPreset(name) { state.activePreset = name; emit(); },
    renamePreset(from, to) {
      state.presets = state.presets.map((p) => (p === from ? to : p));
      if (state.activePreset === from) state.activePreset = to;
      emit();
    },
    deletePreset(name) {
      state.presets = state.presets.filter((p) => p !== name);
      if (state.activePreset === name) state.activePreset = null;
      emit();
    },
  };
}

// ---- Real JUCE engine -----------------------------------------------------
// The "error" event payload is { message: string }; tolerate a bare string too.
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string")
    return (e as { message: string }).message;
  return "Something went wrong in the audio engine.";
}


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
    setGate: fn("setGate"),
    setTuner: fn("setTuner"),
    openEditor: fn("openEditor"),
    savePreset: fn("savePreset"),
    loadPreset: fn("loadPreset"),
    renamePreset: fn("renamePreset"),
    deletePreset: fn("deletePreset"),
    getAudioSetup: fn("getAudioSetup"),
    setAudioSetup: fn("setAudioSetup"),
    playTestSound: fn("playTestSound"),
    finishSetup: fn("finishSetup"),
    openUrl: fn("openUrl"),
  };

  let current: EngineState | null = null;
  const subs = new Set<(s: EngineState) => void>();
  const notify = () => { if (current) subs.forEach((cb) => cb(current as EngineState)); };

  const errSubs = new Set<(m: string) => void>();
  const emitError = (m: string) => errSubs.forEach((cb) => cb(m));
  const peakSubs = new Set<(p: number[]) => void>();
  const tunerSubs = new Set<(r: TunerReading | null) => void>();

  // Non-null: createJuceBridge only runs when hasRealJuceBackend is true.
  const backend = window.__JUCE__!.backend!;

  backend.addEventListener("state", (s: unknown) => { current = s as EngineState; notify(); });
  // Meters carry the main levels (merged into the state), each input's raw level
  // (for setup) and the tuner's reading; the last two go out on their own channels.
  backend.addEventListener("meters", (m: unknown) => {
    const { inputPeaks, tuner, ...levels } = m as Partial<EngineState> & {
      inputPeaks?: number[];
      tuner?: TunerReading | null;
    };
    if (inputPeaks) peakSubs.forEach((cb) => cb(inputPeaks));
    if (tuner !== undefined) tunerSubs.forEach((cb) => cb(tuner ?? null));
    if (current) { current = { ...current, ...levels }; notify(); }
  });
  // The engine emits failures (a model or plugin that wouldn't load, a bad preset
  // name) as an "error" event carrying { message }.
  backend.addEventListener("error", (e: unknown) => emitError(errorMessage(e)));

  return {
    getState: async () => { current = (await f.getState()) as EngineState; return current; },
    subscribe(cb) {
      subs.add(cb);
      if (current) cb(current);
      else void f.getState().then(
        (s) => { current = s as EngineState; cb(current); },
        (err) => emitError(`Couldn't reach the audio engine: ${String(err)}`),
      );
      return () => { subs.delete(cb); };
    },
    subscribeScope(cb) {
      const tok = backend.addEventListener("scope", (v: unknown) => cb(v as number[]));
      return () => backend.removeEventListener?.(tok);
    },
    subscribeError(cb) {
      errSubs.add(cb);
      return () => { errSubs.delete(cb); };
    },
    subscribeInputPeaks(cb) {
      peakSubs.add(cb);
      return () => { peakSubs.delete(cb); };
    },
    subscribeShowSettings(cb) {
      const tok = backend.addEventListener("showSettings", () => cb());
      return () => backend.removeEventListener?.(tok);
    },
    subscribeTuner(cb) {
      tunerSubs.add(cb);
      return () => { tunerSubs.delete(cb); };
    },
    loadSlot: (t) => void f.loadSlot(t),
    clearSlot: (t) => void f.clearSlot(t),
    setBypass: (t, b) => void f.setBypass(t, b),
    setMix: (t, v) => void f.setMix(t, v),
    setGain: (t, v) => void f.setGain(t, v),
    setInput: (v) => void f.setInput(v),
    setMaster: (v) => void f.setMaster(v),
    setMonitor: (b) => void f.setMonitor(b),
    setGate: (v) => void f.setGate(v),
    setTuner: (b) => void f.setTuner(b),
    openEditor: () => void f.openEditor(),
    savePreset: (n) => void f.savePreset(n),
    loadPreset: (n) => void f.loadPreset(n),
    renamePreset: (from, to) => void f.renamePreset(from, to),
    deletePreset: (n) => void f.deletePreset(n),
    getAudioSetup: async () => (await f.getAudioSetup()) as AudioSetup,
    setAudioSetup: async (c) => (await f.setAudioSetup(c)) as AudioSetup,
    playTestSound: () => void f.playTestSound(),
    finishSetup: () => void f.finishSetup(),
    openUrl: (u) => void f.openUrl(u),
  };
}

export const isMock = !hasRealJuceBackend;
export const bridge: Bridge = hasRealJuceBackend ? createJuceBridge() : createMockBridge();
