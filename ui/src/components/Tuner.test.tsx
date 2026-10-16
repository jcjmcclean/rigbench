import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { fake } from "../test/fakeBridge";
import { Tuner } from "./Tuner";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

beforeEach(() => fake.reset());

const reading = (note: string, octave: number, cents: number) => ({ note, octave, cents, hz: 0 });

describe("Tuner", () => {
  it("turns the engine's tuner on while open and off when closed", () => {
    const { unmount } = render(<Tuner onClose={() => {}} />);
    expect(fake.bridge.setTuner).toHaveBeenCalledExactlyOnceWith(true);
    expect(fake.tunerSubscribers()).toBe(1);
    unmount();
    expect(fake.bridge.setTuner).toHaveBeenLastCalledWith(false);
    expect(fake.tunerSubscribers()).toBe(0);
  });

  it("asks for a single string until it hears a note", () => {
    render(<Tuner onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Tuner" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Play a single string.");
    expect(screen.getByText("Your output is muted while the tuner is open.")).toBeInTheDocument();
  });

  it("shows the note and octave, and which way to turn the peg", () => {
    render(<Tuner onClose={() => {}} />);

    act(() => fake.emitTuner(reading("A", 2, -12.4)));
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("12 cents flat: tune up.");

    act(() => fake.emitTuner(reading("A", 2, 7.6)));
    expect(screen.getByRole("status")).toHaveTextContent("8 cents sharp: tune down.");

    act(() => fake.emitTuner(reading("A", 2, 2.9)));
    expect(screen.getByRole("status")).toHaveTextContent("In tune.");
    act(() => fake.emitTuner(reading("A", 2, -3)));
    expect(screen.getByRole("status")).toHaveTextContent("In tune.");
  });

  it("moves the needle with the cents, pinned to the ends of the scale", () => {
    const { container } = render(<Tuner onClose={() => {}} />);
    const needle = () => container.querySelector<HTMLElement>(".tuner__needle")!;

    act(() => fake.emitTuner(reading("E", 2, -25)));
    expect(needle().style.left).toBe("25%");
    act(() => fake.emitTuner(reading("E", 2, 80)));
    expect(needle().style.left).toBe("100%");
    act(() => fake.emitTuner(reading("E", 2, -80)));
    expect(needle().style.left).toBe("0%");
  });

  it("goes back to waiting when the note stops", () => {
    const { container } = render(<Tuner onClose={() => {}} />);
    act(() => fake.emitTuner(reading("E", 4, 0)));
    expect(container.querySelector(".tuner")).toHaveClass("is-in-tune");
    act(() => fake.emitTuner(null));
    expect(container.querySelector(".tuner")).toHaveClass("is-idle");
    expect(screen.getByRole("status")).toHaveTextContent("Play a single string.");
  });

  it("Done and Escape close it", () => {
    const onClose = vi.fn();
    render(<Tuner onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
