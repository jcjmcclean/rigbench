import { describe as group, expect, it } from "vitest";
import { describe, detectPitch, windowFor } from "./pitch";

// The same cases as the engine's tuner tests (tests/TunerTests.cpp), so the
// website's microphone tuner reads a guitar the way the app does.

// A small seeded generator, so the noise is the same on every run.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// A plucked-string-ish tone: fundamental plus decaying harmonics and a little noise.
function guitarNote(hz: number, rate: number, n: number, amp = 0.3) {
  const x = new Float32Array(n);
  const rand = rng(7);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * hz * h * t) / (h * 1.3);
    x[i] = amp * v + 0.002 * (rand() - 0.5);
  }
  return x;
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

group("detectPitch", () => {
  it("finds the pitch of every open string within a cent or two", () => {
    // Standard tuning, plus drop D's low D and a fretted high note.
    for (const hz of [82.41, 110, 146.83, 196, 246.94, 329.63, 73.42, 659.26, 1046.5]) {
      for (const rate of [44100, 48000, 96000]) {
        const found = detectPitch(guitarNote(hz, rate, windowFor(rate)), rate);
        expect(found, `${hz} Hz at ${rate}`).toBeGreaterThan(0);
        expect(Math.abs(cents(found, hz)), `${hz} Hz at ${rate}`).toBeLessThan(2);
      }
    }
  });

  it("says nothing for silence, hiss, or a quiet room", () => {
    const n = 4096;
    expect(detectPitch(new Float32Array(n), 48000)).toBe(0);

    const rand = rng(3);
    const noise = Float32Array.from({ length: n }, () => 0.3 * (rand() * 2 - 1));
    expect(detectPitch(noise, 48000)).toBe(0);

    expect(detectPitch(guitarNote(110, 48000, n, 0.001), 48000)).toBe(0);
  });

  it("reads a window as long as two periods of the lowest note", () => {
    expect(windowFor(48000)).toBe(4096);
    expect(windowFor(44100)).toBe(4096);
    expect(windowFor(96000)).toBe(8192);
    expect(windowFor(8000)).toBe(512);
  });
});

group("describe", () => {
  it("names notes and how far off they are", () => {
    const e2 = describe(82.41);
    expect([e2.note, e2.octave]).toEqual(["E", 2]);
    expect(Math.abs(e2.cents)).toBeLessThan(0.5);

    expect(describe(440)).toMatchObject({ note: "A", octave: 4, cents: 0, hz: 440 });
    expect(describe(440 * 2 ** (20 / 1200)).cents).toBeCloseTo(20, 2);
    expect(describe(440 * 2 ** (-30 / 1200)).cents).toBeCloseTo(-30, 2);

    expect(describe(466.16).note).toBe("A#");
    expect(describe(261.63)).toMatchObject({ note: "C", octave: 4 });
  });
});
