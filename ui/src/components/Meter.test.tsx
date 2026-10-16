import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Meter } from "./Meter";

afterEach(cleanup);

// Meter geometry: the number of lit segments is round(clamp01(value) * segments).
// Orientation only reorders cells, never changes how many are lit.
function litCount(container: HTMLElement) {
  return container.querySelectorAll(".meter__seg.is-on").length;
}

describe("Meter level -> geometry", () => {
  it("lights half the segments at 0.5", () => {
    const { container } = render(<Meter value={0.5} segments={14} />);
    expect(litCount(container)).toBe(7);
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
    const { container } = render(<Meter value={0.3} segments={10} />);
    expect(container.querySelectorAll(".meter__seg").length).toBe(10);
    expect(litCount(container)).toBe(3);
  });

  it("lights the same count in horizontal orientation", () => {
    const { container } = render(<Meter value={0.5} segments={14} orientation="h" />);
    expect(litCount(container)).toBe(7);
  });
});
