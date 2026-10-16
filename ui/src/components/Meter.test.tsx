import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Meter } from "./Meter";
import { meterPosition } from "../meterScale";

afterEach(cleanup);

// Meter geometry: the value is a peak amplitude shown on a dB scale from -60 dBFS
// (nothing lit) to 0 dBFS (all lit); lit = round(position * segments).
// Orientation only reorders cells, never changes how many are lit.
const dB = (d: number) => 10 ** (d / 20);
function litCount(container: HTMLElement) {
  return container.querySelectorAll(".meter__seg.is-on").length;
}

describe("Meter level -> geometry", () => {
  it("lights half the segments at -30 dBFS", () => {
    const { container } = render(<Meter value={dB(-30)} segments={14} />);
    expect(litCount(container)).toBe(7);
  });

  it("puts a typical guitar level (-18 dBFS) well up the scale", () => {
    const { container } = render(<Meter value={dB(-18)} segments={14} />);
    expect(litCount(container)).toBe(10);
  });

  it("lights none at or below -60 dBFS", () => {
    const { container } = render(<Meter value={dB(-70)} segments={14} />);
    expect(litCount(container)).toBe(0);
  });

  it("lights none at 0", () => {
    const { container } = render(<Meter value={0} segments={14} />);
    expect(litCount(container)).toBe(0);
  });

  it("lights all at full scale", () => {
    const { container } = render(<Meter value={1} segments={14} />);
    expect(litCount(container)).toBe(14);
  });

  it("clamps values above 1", () => {
    const { container } = render(<Meter value={2} segments={14} />);
    expect(litCount(container)).toBe(14);
  });

  it("clamps negative values to zero", () => {
    const { container } = render(<Meter value={-0.5} segments={14} />);
    expect(litCount(container)).toBe(0);
  });

  it("renders exactly `segments` cells regardless of level", () => {
    const { container } = render(<Meter value={dB(-42)} segments={10} />);
    expect(container.querySelectorAll(".meter__seg").length).toBe(10);
    expect(litCount(container)).toBe(3);
  });

  it("lights the same count in horizontal orientation", () => {
    const { container } = render(<Meter value={dB(-30)} segments={14} orientation="h" />);
    expect(litCount(container)).toBe(7);
  });

  it("meterPosition maps dBFS linearly onto 0..1", () => {
    expect(meterPosition(1)).toBe(1);
    expect(meterPosition(dB(-30))).toBeCloseTo(0.5, 6);
    expect(meterPosition(dB(-6))).toBeCloseTo(0.9, 6);
    expect(meterPosition(0)).toBe(0);
    expect(meterPosition(NaN)).toBe(0);
    expect(meterPosition(-1)).toBe(0);
  });
});
