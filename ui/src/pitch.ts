// Pitch detection for the website's microphone tuner: the same YIN search as the
// engine's (src/app/Tuner.cpp), so the browser preview reads a guitar the way the
// app does. The app itself never uses this; its readings come from the engine.
import type { TunerReading } from "./types";

export const MIN_HZ = 40;
export const MAX_HZ = 1400;

// Decimate to about 24 kHz before searching: plenty for guitar fundamentals,
// and it keeps the search the same size at any device rate.
const decimationFor = (rate: number) => Math.max(1, Math.round(rate / 24000));

// Two periods of the lowest note, rounded up to a power of two.
export function windowFor(rate: number): number {
  const want = 2 ** Math.ceil(Math.log2((rate * 2) / MIN_HZ));
  return Math.min(16384, Math.max(512, want));
}

// The fundamental of x in Hz, or 0 when it isn't one clear note (silence,
// hiss, chords).
export function detectPitch(x: Float32Array, rate: number): number {
  const n = x.length;
  if (n < 64 || rate <= 0) return 0;

  // Too quiet to be a played note (about -50 dBFS peak).
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 0.003) return 0;

  // Decimate (averaging k samples is enough of a low-pass for pitch).
  const k = decimationFor(rate);
  const m = Math.floor(n / k);
  const r = rate / k;
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += x[k * i + j];
    y[i] = sum / k;
  }

  // YIN (de Cheveigné & Kawahara 2002): difference function, cumulative mean
  // normalised, first dip under the threshold.
  const tauMin = Math.max(2, Math.floor(r / MAX_HZ));
  const tauMax = Math.min(Math.floor(m / 2), Math.ceil(r / MIN_HZ));
  if (tauMax <= tauMin + 2) return 0;

  const w = m - tauMax;
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const diff = y[i] - y[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  const cmnd = new Float64Array(tauMax + 1).fill(1);
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  const threshold = 0.15;
  let best = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) return 0;

  // Refine at the full rate around k * best, then interpolate between neighbours.
  const lo = Math.max(1, k * best - k - 1);
  const hi = Math.min(Math.floor(n / 2) - 1, k * best + k + 1);
  const fw = n - hi - 1;
  const fd = new Float64Array(hi - lo + 1);
  let fb = lo;
  for (let tau = lo; tau <= hi; tau++) {
    let sum = 0;
    for (let i = 0; i < fw; i++) {
      const dl = x[i] - x[i + tau];
      sum += dl * dl;
    }
    fd[tau - lo] = sum;
    if (sum < fd[fb - lo]) fb = tau;
  }

  let period = fb;
  if (fb > lo && fb < hi) {
    const a = fd[fb - lo - 1], b = fd[fb - lo], c = fd[fb - lo + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-12) period = fb + (0.5 * (a - c)) / denom;
  }

  const hz = rate / period;
  return hz >= MIN_HZ && hz <= MAX_HZ ? hz : 0;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// The nearest note to hz, and how many cents off it is.
export function describe(hz: number, a4 = 440): TunerReading {
  const midi = 69 + 12 * Math.log2(hz / a4);
  const note = Math.round(midi);
  return {
    note: NAMES[((note % 12) + 12) % 12],
    octave: Math.floor(note / 12) - 1,
    cents: (midi - note) * 100,
    hz,
  };
}
