import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Knob } from "./Knob";

// Explicit vitest imports mean Testing Library's auto-cleanup isn't registered,
// so unmount between tests to keep one <Knob> in the DOM per case.
afterEach(cleanup);

// The Knob's value math is pure arithmetic on a normalised fraction:
//   commit(f) => onChange(min + clamp01(f) * (max - min))
// Arrow keys step that fraction (0.05 coarse, 0.01 with Shift) and clamp at the
// ends. These tests pin that math so a refactor can't silently change feel.

describe("Knob keyboard value math", () => {
  it("steps up by 0.05 of the range on ArrowUp", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.55, 6);
  });

  it("steps down on ArrowDown", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowDown" });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.45, 6);
  });

  it("uses a fine 0.01 step when Shift is held", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp", shiftKey: true });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.51, 6);
  });

  it("maps the fraction onto a non-default [min,max] range", () => {
    const onChange = vi.fn();
    render(<Knob value={5} min={0} max={10} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    // frac 0.5 -> +0.05 -> 0.55 of range 10 => 5.5
    expect(onChange.mock.calls[0][0]).toBeCloseTo(5.5, 6);
  });

  it("clamps at the maximum", () => {
    const onChange = vi.fn();
    render(<Knob value={1} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(1, 6);
  });

  it("clamps at the minimum", () => {
    const onChange = vi.fn();
    render(<Knob value={0} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowDown" });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0, 6);
  });

  it("does not respond when disabled", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} disabled />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
