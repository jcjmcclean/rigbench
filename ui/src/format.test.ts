import { describe, expect, it } from "vitest";
import { dbFromUnit, gateLabel, pct01, percent } from "./format";

describe("pct01 (unit -> bare integer percent)", () => {
  it.each([
    [0, "0"],
    [0.8, "80"],
    [1, "100"],
    [0.123, "12"],
    [0.125, "13"], // Math.round: halves round up
    [0.995, "100"],
  ])("%s -> %s", (v, out) => {
    expect(pct01(v)).toBe(out);
  });

  it("has no suffix", () => {
    expect(pct01(0.5)).not.toMatch(/%/);
  });
});

describe("percent (unit -> percent with suffix)", () => {
  it.each([
    [0, "0%"],
    [0.5, "50%"],
    [1, "100%"],
    [0.954, "95%"],
  ])("%s -> %s", (v, out) => {
    expect(percent(v)).toBe(out);
  });
});

describe("dbFromUnit (unit -> signed dB trim, x48 dB span centred on 0.5)", () => {
  // The x48 mapping must match the engine's NamNode.h:
  //   setOutputTrimDb((v01 - 0.5f) * 48.0f)
  it.each([
    [0.5, "+0 dB"],
    [1, "+24 dB"],
    [0, "-24 dB"],
    [0.75, "+12 dB"],
    [0.25, "-12 dB"],
    [0.55, "+2 dB"], // 2.4 dB -> rounds to 2
    [0.45, "-2 dB"],
  ])("%s -> %s", (v, out) => {
    expect(dbFromUnit(v)).toBe(out);
  });

  it("always signs non-negative values with +", () => {
    expect(dbFromUnit(0.6)).toMatch(/^\+/);
  });

  it("never shows a negative zero just below centre (e.g. one fine step down)", () => {
    // 0.49 -> -0.48 dB, which rounds to zero: it must read "+0 dB", not "-0 dB".
    expect(dbFromUnit(0.49)).toBe("+0 dB");
    expect(dbFromUnit(0.5 - 1e-9)).toBe("+0 dB");
  });
});

describe("gateLabel", () => {
  it("reads Off at 0, then the threshold in dB (matches AudioPath::gateThresholdDb)", () => {
    expect(gateLabel(0)).toBe("Off");
    expect(gateLabel(-0.1)).toBe("Off");
    expect(gateLabel(0.01)).toBe("-79 dB");
    expect(gateLabel(0.5)).toBe("-50 dB");
    expect(gateLabel(1)).toBe("-20 dB");
  });
});
