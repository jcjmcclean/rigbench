export type SlotType = "vst3" | "nam" | "ir";

export interface SlotState {
  type: SlotType;
  loaded: boolean;
  name: string;        // loaded file / plugin name
  bypassed: boolean;
  mix?: number;        // IR dry/wet, 0..1
  gain?: number;       // level trim, 0..1 (0.5 = 0 dB)
  hasEditor?: boolean; // VST3
}

export interface EngineState {
  device: string;
  sampleRate: number;   // Hz
  bufferSize: number;   // samples
  roundTripMs: number;
  setupComplete: boolean; // first-run setup done (until then monitoring starts off)
  monitoring: boolean;
  inputGain: number;    // 0..1 (trim into the chain)
  masterGain: number;   // 0..1
  gate: number;         // input noise gate, 0 = off .. 1 (threshold -80..-20 dB)
  playing: boolean;     // signal present
  inputLevel: number;   // 0..1 (peak)
  outputLevel: number;  // 0..1
  slots: Record<SlotType, SlotState>;
  presets: string[];
  activePreset: string | null;
}

// The audio device choices (C++ AudioSetup::describe). Settings and first-run
// setup read this and send AudioSetupChanges back.
export interface AudioSetup {
  driver: string;          // "CoreAudio", "Windows Audio", "ASIO", "ALSA", ...
  drivers: string[];
  inputDevice: string;     // where the guitar comes in
  inputDevices: string[];
  outputDevice: string;    // where you hear it
  outputDevices: string[];
  inputs: string[];        // the input device's channel names
  input: number;           // which of those the guitar is on, -1 if none
  listeningToAll: boolean; // every input open (setup's "play a few notes" step)
  sampleRate: number;
  sampleRates: number[];
  bufferSize: number;
  bufferSizes: number[];
  latencyMs: number;       // round trip
  builtInInput: boolean;   // looks like the computer's own mic
  error: string;           // why the device couldn't be opened / a change failed, or ""
}

export interface AudioSetupChanges {
  driver?: string;
  inputDevice?: string;
  outputDevice?: string;
  input?: number;
  listenToAllInputs?: boolean;
  sampleRate?: number;
  bufferSize?: number;
}

// A VST3 plugin installed in one of the standard folders.
export interface PluginInfo {
  name: string;
  path: string;
}

// What the tuner hears (C++ RigController::readTuner).
export interface TunerReading {
  note: string;    // "E", "A#" ...
  octave: number;  // E2 is the low E string
  cents: number;   // -50..+50 from that note
  hz: number;
}

export interface Bridge {
  getState(): Promise<EngineState>;
  subscribe(cb: (s: EngineState) => void): () => void;
  // Live signal scope: batches of decimated, signed samples (~-1..1) from the
  // audio thread, newest last. Flat/near-zero when there's no input.
  subscribeScope(cb: (samples: number[]) => void): () => void;
  // Backend error channel (e.g. a plugin/model failed to load). The real JUCE
  // engine emits an "error" event with a human-readable message; the UI surfaces
  // it as a toast. In a plain browser the mock wires a no-op.
  subscribeError(cb: (message: string) => void): () => void;
  // Raw level (0..1 peak) of each input the device has open, ~30 Hz. First-run
  // setup uses it to find which input the guitar is on.
  subscribeInputPeaks(cb: (peaks: number[]) => void): () => void;
  // While the tuner is on: what it hears (~30 Hz), or null when there's no clear note.
  subscribeTuner(cb: (reading: TunerReading | null) => void): () => void;
  // The native menu's "Settings..." asks the UI to open its Settings screen.
  subscribeShowSettings(cb: () => void): () => void;
  loadSlot(type: SlotType): void;             // opens a file chooser for that slot
  listPlugins(): Promise<PluginInfo[]>;        // installed VST3s (scans the standard folders)
  loadPlugin(path: string): void;              // one from the latest listPlugins answer
  clearSlot(type: SlotType): void;
  setBypass(type: SlotType, bypassed: boolean): void;
  setMix(type: SlotType, value: number): void;
  setGain(type: SlotType, value: number): void;
  setInput(value: number): void;
  setMaster(value: number): void;
  setMonitor(on: boolean): void;
  setGate(value: number): void;      // 0 = off
  setTuner(on: boolean): void;       // tuner on mutes the output
  openEditor(): void;
  savePreset(name: string): void;
  loadPreset(name: string): void;
  renamePreset(from: string, to: string): void;
  deletePreset(name: string): void;   // the rig keeps playing; it's just not saved any more
  getAudioSetup(): Promise<AudioSetup>;
  setAudioSetup(changes: AudioSetupChanges): Promise<AudioSetup>;
  playTestSound(): void;
  // Marks first-run setup done. startMonitoring (default true) also turns
  // monitoring on; Skip passes false so a laptop mic can't feed back.
  finishSetup(startMonitoring?: boolean): void;
  openUrl(url: string): void;   // in the system browser (https only)
}
