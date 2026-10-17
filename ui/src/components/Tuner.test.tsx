import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { fake } from "../test/fakeBridge";
import { LEDS, litLed } from "../tunerScale";
import { Tuner } from "./Tuner";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

beforeEach(() => fake.reset());

const reading = (note: string, octave: number, cents: number) => ({ note, octave, cents, hz: 0 });
const advice = () => document.querySelector(".tuner__advice")!;

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
    expect(advice()).toHaveTextContent("Play a single string.");
    expect(screen.getByText("Your output is muted while the tuner is open.")).toBeInTheDocument();
  });

  it("shows the note and octave, and which way to turn the peg", () => {
    render(<Tuner onClose={() => {}} />);

    act(() => fake.emitTuner(reading("A", 2, -12.4)));
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(advice()).toHaveTextContent("12 cents flat: tune up.");

    act(() => fake.emitTuner(reading("A", 2, 7.6)));
    expect(advice()).toHaveTextContent("8 cents sharp: tune down.");

    act(() => fake.emitTuner(reading("A", 2, 2.9)));
    expect(advice()).toHaveTextContent("In tune.");
    act(() => fake.emitTuner(reading("A", 2, -3)));
    expect(advice()).toHaveTextContent("In tune.");
  });

  it("lights the LED for how far off you are, 5 cents each, pinned to the ends", () => {
    const { container } = render(<Tuner onClose={() => {}} />);
    const leds = () => [...container.querySelectorAll(".tuner__led")];
    const lit = () => leds().flatMap((el, i) => (el.classList.contains("is-on") ? [i] : []));

    expect(leds()).toHaveLength(LEDS);
    expect(lit()).toEqual([]);

    act(() => fake.emitTuner(reading("E", 2, -25)));
    expect(lit()).toEqual([5]);
    act(() => fake.emitTuner(reading("E", 2, 80)));
    expect(lit()).toEqual([20]);
    act(() => fake.emitTuner(reading("E", 2, -80)));
    expect(lit()).toEqual([0]);
  });

  it("the middle LED means in tune: just outside, its neighbour lights instead", () => {
    expect(litLed(0)).toBe(10);
    expect(litLed(3)).toBe(10);
    expect(litLed(-3)).toBe(10);
    expect(litLed(3.4)).toBe(11);
    expect(litLed(-3.4)).toBe(9);
    expect(litLed(-12)).toBe(8);
    expect(litLed(28)).toBe(16);
  });

  it("lights the ♭ or ♯ lamp for the side you're on, and neither in tune", () => {
    const { container } = render(<Tuner onClose={() => {}} />);
    const lamps = () => [...container.querySelectorAll(".tuner__lamp")].map((el) => el.classList.contains("is-on"));

    expect(lamps()).toEqual([false, false]);
    act(() => fake.emitTuner(reading("E", 2, -12)));
    expect(lamps()).toEqual([true, false]);
    act(() => fake.emitTuner(reading("E", 2, 12)));
    expect(lamps()).toEqual([false, true]);
    act(() => fake.emitTuner(reading("E", 2, 1)));
    expect(lamps()).toEqual([false, false]);
    expect(container.querySelector(".tuner__led.is-near")).toBeNull();
  });

  it("writes sharps as ♯", () => {
    const { container } = render(<Tuner onClose={() => {}} />);
    act(() => fake.emitTuner(reading("F#", 3, 0)));
    expect(container.querySelector(".tuner__note")).toHaveTextContent(/^F♯3$/);
  });

  it("goes back to waiting when the note stops", () => {
    const { container } = render(<Tuner onClose={() => {}} />);
    act(() => fake.emitTuner(reading("E", 4, 0)));
    expect(container.querySelector(".tuner")).toHaveClass("is-in-tune");
    act(() => fake.emitTuner(null));
    expect(container.querySelector(".tuner")).toHaveClass("is-idle");
    expect(advice()).toHaveTextContent("Play a single string.");
  });

  it("the visible readout isn't a live region; one hidden status line speaks for it", () => {
    const { container } = render(<Tuner onClose={() => {}} />);
    act(() => fake.emitTuner(reading("E", 2, -20)));
    // Nothing that changes 30 times a second is announced.
    expect(container.querySelector(".tuner__note")).not.toHaveAttribute("aria-live");
    expect(advice()).not.toHaveAttribute("role");
    expect(container.querySelectorAll("[aria-live], [role=status], [role=alert]")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveClass("visually-hidden");
  });

  it("announces only when the note changes, or that note first gets in tune", () => {
    render(<Tuner onClose={() => {}} />);
    const status = screen.getByRole("status");
    // Every change to the live region's text is something a screen reader says.
    const heard: string[] = [];
    const emit = (r: ReturnType<typeof reading> | null) => {
      act(() => fake.emitTuner(r));
      const text = status.textContent ?? "";
      if (text !== (heard.at(-1) ?? "")) heard.push(text);
    };

    expect(status).toBeEmptyDOMElement();
    // A stream of readings for one note, tuning up into tune and wobbling about.
    for (const c of [-30, -22, -15, -9, -5, -2, 1, -1, 4, -6, 2, 0]) emit(reading("E", 2, c));
    expect(status).toHaveTextContent("In tune");
    // Silence between plucks says nothing.
    emit(null);
    emit(reading("E", 2, 1));
    // A new string.
    for (const c of [12, 9, 6]) emit(reading("A", 2, c));
    // A new note that's already in tune says both at once.
    emit(reading("D", 3, 0));
    emit(reading("D", 3, 1));
    // Sharps are said as words.
    emit(reading("F#", 3, -10));

    expect(heard).toEqual(["E 2", "In tune", "A 2", "D 3, in tune", "F sharp 3"]);
  });

  it("Done and Escape close it", () => {
    const onClose = vi.fn();
    render(<Tuner onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
