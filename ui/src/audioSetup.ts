// Plain-language helpers for the audio setup screens.

// An input counts as "the guitar" once it peaks above this (about -26 dBFS).
export const FOUND_LEVEL = 0.05;

// The input the guitar is probably on: the loudest one that's clearly being played.
export function findGuitar(held: number[]): number | null {
  let best = -1;
  held.forEach((v, i) => { if (v > FOUND_LEVEL && (best < 0 || v > held[best])) best = i; });
  return best >= 0 ? best : null;
}

// What to tell the player about their input level, from a recent peak (0..1).
export function levelAdvice(peak: number): string {
  if (peak >= 0.98) return "Too loud: it’s clipping. Turn the gain on your interface down a little.";
  if (peak < 0.03)
    return "Quite quiet. Turn the gain up on your interface, or switch that input to Instrument (Hi-Z) if it has the option.";
  return "Good level.";
}

// Buffer size in samples → how long it takes, in ms.
export function bufferMs(samples: number, sampleRate: number): number {
  return sampleRate > 0 ? (samples / sampleRate) * 1000 : 0;
}

// "128 samples · 2.7 ms"
export function bufferLabel(samples: number, sampleRate: number): string {
  return `${samples} samples · ${bufferMs(samples, sampleRate).toFixed(1)} ms`;
}

// "48 kHz", "44.1 kHz"
export function rateLabel(sampleRate: number): string {
  if (sampleRate <= 0) return "—";
  const k = sampleRate / 1000;
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)} kHz`;
}
