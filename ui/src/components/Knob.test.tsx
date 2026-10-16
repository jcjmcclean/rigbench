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

describe("Knob keyboard: horizontal arrows and other keys", () => {
  it("ArrowRight steps up and ArrowLeft steps down like Up/Down", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    fireEvent.keyDown(dial, { key: "ArrowRight" });
    fireEvent.keyDown(dial, { key: "ArrowLeft" });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.55, 6);
    expect(onChange.mock.calls[1][0]).toBeCloseTo(0.45, 6);
  });

  it("prevents the page from scrolling on handled arrows only", () => {
    render(<Knob value={0.5} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    expect(fireEvent.keyDown(dial, { key: "ArrowUp" })).toBe(false); // default prevented
    expect(fireEvent.keyDown(dial, { key: "a" })).toBe(true);
  });

  it("ignores unrelated keys", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("slider"), { key: " " });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Knob accessibility + readout", () => {
  it("exposes slider semantics labelled by its label", () => {
    render(<Knob value={0.25} onChange={vi.fn()} label="Gain" />);
    const dial = screen.getByRole("slider", { name: "Gain" });
    expect(dial).toHaveAttribute("aria-valuenow", "25");
    expect(dial).toHaveAttribute("aria-valuemin", "0");
    expect(dial).toHaveAttribute("aria-valuemax", "100");
    expect(dial).toHaveAttribute("aria-valuetext", "25");
    expect(dial).toHaveAttribute("tabindex", "0");
  });

  it("shows the formatted value as text and as aria-valuetext", () => {
    render(<Knob value={0.5} onChange={vi.fn()} label="Mix" format={(v) => `${v * 10}!`} />);
    expect(screen.getByText("5!")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Mix" })).toHaveAttribute("aria-valuetext", "5!");
  });

  it("reports aria-valuenow as a percentage of a custom range", () => {
    render(<Knob value={7.5} min={5} max={10} onChange={vi.fn()} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "50");
  });

  it("clamps the displayed fraction for out-of-range values", () => {
    render(<Knob value={3} onChange={vi.fn()} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "100");
  });

  it("has no label/readout and no accessible name when unlabelled", () => {
    const { container } = render(<Knob value={0.5} onChange={vi.fn()} />);
    expect(screen.getByRole("slider")).not.toHaveAttribute("aria-labelledby");
    expect(container.querySelector(".knob__meta")).toBeNull();
  });

  it("is removed from the tab order when disabled", () => {
    render(<Knob value={0.5} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("slider")).toHaveAttribute("tabindex", "-1");
  });
});

describe("Knob mouse wheel", () => {
  it("wheel up (negative deltaY) raises the value by 0.03", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: -100 });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.53, 6);
  });

  it("wheel down lowers it; magnitude of deltaY doesn't matter", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: 3 });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.47, 6);
  });

  it("uses a fine 0.01 step with Shift", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: -1, shiftKey: true });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.51, 6);
  });

  it("prevents the page from scrolling while adjusting", () => {
    render(<Knob value={0.5} onChange={vi.fn()} />);
    expect(fireEvent.wheel(screen.getByRole("slider"), { deltaY: -1 })).toBe(false);
  });

  it("uses the latest value after a re-render (no stale closure)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Knob value={0.5} onChange={onChange} />);
    rerender(<Knob value={0.2} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: -1 });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.23, 6);
  });

  it("clamps at the ends", () => {
    const onChange = vi.fn();
    render(<Knob value={0.99} onChange={onChange} />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: -1 });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(1, 6);
  });

  it("is ignored when disabled", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} disabled />);
    expect(fireEvent.wheel(screen.getByRole("slider"), { deltaY: -1 })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Knob pointer drag", () => {
  // Vertical drag: 180px of travel covers the full range (Shift = quarter speed).
  it("dragging up raises the value proportionally to distance from the grab point", () => {
    const onChange = vi.fn();
    render(<Knob value={0.2} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { clientY: 300, pointerId: 7 });
    fireEvent.pointerMove(dial, { clientY: 210 }); // 90px up
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(0.7, 6);
    fireEvent.pointerMove(dial, { clientY: 327 }); // 27px below the grab point = -0.15
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(0.05, 6);
  });

  it("measures from the starting value, not the latest prop", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Knob value={0.5} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { clientY: 100 });
    rerender(<Knob value={0.9} onChange={onChange} />); // parent echoes a new value mid-drag
    fireEvent.pointerMove(dial, { clientY: 82 }); // 18px up = +0.1
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(0.6, 6);
  });

  it("Shift during the drag gives fine control (quarter speed)", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { clientY: 200 });
    fireEvent.pointerMove(dial, { clientY: 110, shiftKey: true }); // 90px * 0.25
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(0.625, 6);
  });

  it("clamps the dragged value to the range", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} min={-1} max={1} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { clientY: 500 });
    fireEvent.pointerMove(dial, { clientY: 0 });
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(1, 6);
    fireEvent.pointerMove(dial, { clientY: 2000 });
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(-1, 6);
  });

  it("captures the pointer on press and releases it on release", () => {
    render(<Knob value={0.5} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    const capture = vi.spyOn(dial, "setPointerCapture");
    const release = vi.spyOn(dial, "releasePointerCapture");
    fireEvent.pointerDown(dial, { clientY: 10, pointerId: 42 });
    expect(capture).toHaveBeenCalledWith(42);
    fireEvent.pointerUp(dial, { clientY: 10, pointerId: 42 });
    expect(release).toHaveBeenCalledWith(42);
  });

  it("stops responding to movement after release", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { clientY: 100 });
    fireEvent.pointerUp(dial, { clientY: 100 });
    fireEvent.pointerMove(dial, { clientY: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores movement without a press (hover)", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} />);
    fireEvent.pointerMove(screen.getByRole("slider"), { clientY: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not start a drag when disabled", () => {
    const onChange = vi.fn();
    render(<Knob value={0.5} onChange={onChange} disabled />);
    const dial = screen.getByRole("slider");
    const capture = vi.spyOn(dial, "setPointerCapture");
    fireEvent.pointerDown(dial, { clientY: 100 });
    fireEvent.pointerMove(dial, { clientY: 0 });
    expect(capture).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
