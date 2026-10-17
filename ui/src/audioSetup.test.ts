import { describe, expect, it } from "vitest";
import { FOUND_LEVEL, bufferLabel, bufferMs, findGuitar, levelAdvice, rateLabel } from "./audioSetup";

describe("FOUND_LEVEL", () => {
  it("is about -26 dBFS: clearly above input hiss, well below a played note", () => {
    expect(20 * Math.log10(FOUND_LEVEL)).toBeCloseTo(-26, 0);
  });
});

describe("findGuitar", () => {
  it("returns null when nothing has been heard", () => {
    expect(findGuitar([])).toBeNull();
    expect(findGuitar([0, 0, 0])).toBeNull();
  });

  it("ignores hiss at or below FOUND_LEVEL (strictly above counts)", () => {
    expect(findGuitar([0.004, 0.01])).toBeNull();
    expect(findGuitar([FOUND_LEVEL, FOUND_LEVEL])).toBeNull();
    expect(findGuitar([0, FOUND_LEVEL + 1e-6])).toBe(1);
  });

  it("picks the loudest input that is clearly being played", () => {
    expect(findGuitar([0.004, 0.6])).toBe(1);
    expect(findGuitar([0.3, 0.9, 0.2])).toBe(1);
    expect(findGuitar([0.9, 0.3])).toBe(0);
    expect(findGuitar([0.06, 0, 0, 0.07])).toBe(3);
  });

  it("keeps the first of equally loud inputs", () => {
    expect(findGuitar([0.5, 0.5])).toBe(0);
    expect(findGuitar([0.1, 0.5, 0.5])).toBe(1);
  });

  it("works for a single-input device", () => {
    expect(findGuitar([0.2])).toBe(0);
    expect(findGuitar([0.01])).toBeNull();
  });

  it("handles a clipping input (1.0)", () => {
    expect(findGuitar([0.4, 1])).toBe(1);
  });
});

describe("levelAdvice", () => {
  const LOUD = /Too loud/;
  const QUIET = /A bit quiet/;
  it.each([
    [0, QUIET],
    [0.0299, QUIET],
    [0.03, /^Good level\.$/],
    [0.5, /^Good level\.$/],
    [0.9799, /^Good level\.$/],
    [0.98, LOUD],
    [1, LOUD],
    [1.5, LOUD],
  ])("peak %s → %s", (peak, advice) => {
    expect(levelAdvice(peak)).toMatch(advice);
  });

  it("tells a quiet player what to do about it", () => {
    expect(levelAdvice(0.01)).toMatch(/Turn up the gain/);
    expect(levelAdvice(0.01)).toMatch(/Hi-Z/);
  });

  it("tells a clipping player to turn the gain down", () => {
    expect(levelAdvice(0.99)).toMatch(/clipping/);
    expect(levelAdvice(0.99)).toMatch(/Turn down the gain/);
  });
});

describe("bufferMs", () => {
  it("converts samples at a rate to milliseconds", () => {
    expect(bufferMs(48, 48000)).toBe(1);
    expect(bufferMs(128, 48000)).toBeCloseTo(2.6667, 4);
    expect(bufferMs(441, 44100)).toBeCloseTo(10, 10);
    expect(bufferMs(1024, 96000)).toBeCloseTo(10.6667, 4);
  });

  it("is 0 with no running device (rate 0 or negative), never Infinity/NaN", () => {
    expect(bufferMs(128, 0)).toBe(0);
    expect(bufferMs(128, -1)).toBe(0);
    expect(bufferMs(0, 0)).toBe(0);
  });

  it("is 0 for a zero-sample buffer", () => {
    expect(bufferMs(0, 48000)).toBe(0);
  });
});

describe("bufferLabel", () => {
  it.each([
    [128, 48000, "128 samples · 2.7 ms"],
    [64, 48000, "64 samples · 1.3 ms"],
    [256, 44100, "256 samples · 5.8 ms"],
    [32, 96000, "32 samples · 0.3 ms"],
    [1024, 48000, "1024 samples · 21.3 ms"],
    [480, 48000, "480 samples · 10.0 ms"],
    [128, 0, "128 samples · 0.0 ms"],
  ])("%i samples at %i Hz → %j", (samples, rate, label) => {
    expect(bufferLabel(samples, rate)).toBe(label);
  });
});

describe("rateLabel", () => {
  it.each([
    [48000, "48 kHz"],
    [44100, "44.1 kHz"],
    [96000, "96 kHz"],
    [88200, "88.2 kHz"],
    [192000, "192 kHz"],
    [22050, "22.1 kHz"],
    [8000, "8 kHz"],
  ])("%i Hz → %j", (rate, label) => {
    expect(rateLabel(rate)).toBe(label);
  });

  it("shows a dash with no running device", () => {
    expect(rateLabel(0)).toBe("—");
    expect(rateLabel(-48000)).toBe("—");
  });
});
