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
  monitoring: boolean;
  inputGain: number;    // 0..1 (trim into the chain)
  masterGain: number;   // 0..1
  playing: boolean;     // signal present
  inputLevel: number;   // 0..1 (peak)
  outputLevel: number;  // 0..1
  slots: Record<SlotType, SlotState>;
  presets: string[];
  activePreset: string | null;
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
  loadSlot(type: SlotType): void;
  clearSlot(type: SlotType): void;
  setBypass(type: SlotType, bypassed: boolean): void;
  setMix(type: SlotType, value: number): void;
  setGain(type: SlotType, value: number): void;
  setInput(value: number): void;
  setMaster(value: number): void;
  setMonitor(on: boolean): void;
  openEditor(): void;
  openAudioSettings(): void;
  savePreset(name: string): void;
  loadPreset(name: string): void;
}
