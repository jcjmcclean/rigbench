import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TOAST_MAX_MS, TOAST_MIN_MS, TOAST_PER_CHAR_MS, Toasts, type ToastItem } from "./Toast";

const items = (...msgs: string[]): ToastItem[] => msgs.map((message, i) => ({ id: i + 1, message }));

describe("Toasts rendering", () => {
  it("renders nothing when there are no toasts", () => {
    const { container } = render(<Toasts items={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders each toast as an alert inside a Notifications region, in order", () => {
    render(<Toasts items={items("Model failed to load", "Bad preset name")} onDismiss={vi.fn()} />);
    const region = screen.getByRole("region", { name: "Notifications" });
    const alerts = within(region).getAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual([
      expect.stringContaining("Model failed to load"),
      expect.stringContaining("Bad preset name"),
    ]);
  });

  it("the dismiss button dismisses that toast by id", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[{ id: 11, message: "a" }, { id: 12, message: "b" }]} onDismiss={onDismiss} />);
    const second = screen.getAllByRole("alert")[1];
    fireEvent.click(within(second).getByRole("button", { name: "Dismiss notification" }));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(12);
  });
});

describe("Toast auto-dismiss", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // Advance to just before a deadline, check it's still up, then step over it.
  function expectDismissedAt(ms: number, onDismiss: ReturnType<typeof vi.fn>, id: number) {
    act(() => { vi.advanceTimersByTime(ms - 1); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(id);
  }

  it("uses 6 s plus 60 ms a character, up to 20 s", () => {
    expect([TOAST_MIN_MS, TOAST_PER_CHAR_MS, TOAST_MAX_MS]).toEqual([6000, 60, 20_000]);
  });

  it("a one-character toast stays 6.06 seconds, not less", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[{ id: 3, message: "x" }]} onDismiss={onDismiss} />);
    expectDismissedAt(6060, onDismiss, 3);
  });

  it("a longer message stays up longer, so it can be read", () => {
    const onDismiss = vi.fn();
    const message = "a".repeat(100);   // 6 s + 100 × 60 ms = 12 s
    render(<Toasts items={[{ id: 4, message }]} onDismiss={onDismiss} />);
    expectDismissedAt(12_000, onDismiss, 4);
  });

  it("a very long message is capped at 20 seconds", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[{ id: 5, message: "a".repeat(1000) }]} onDismiss={onDismiss} />);
    expectDismissedAt(20_000, onDismiss, 5);
  });

  it("stops the clock while the pointer is over it, and carries on from where it was", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[{ id: 6, message: "x" }]} onDismiss={onDismiss} />);   // 6060 ms
    act(() => { vi.advanceTimersByTime(5000); });
    fireEvent.mouseEnter(screen.getByRole("alert"));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByRole("alert"));
    expectDismissedAt(1060, onDismiss, 6);
  });

  it("stops the clock while it has keyboard focus", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[{ id: 7, message: "x" }]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(3000); });
    const close = screen.getByRole("button", { name: "Dismiss notification" });
    act(() => { close.focus(); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { close.blur(); });
    expectDismissedAt(3060, onDismiss, 7);
  });

  it("stays paused while either hover or focus holds it", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[{ id: 8, message: "x" }]} onDismiss={onDismiss} />);
    const alert = screen.getByRole("alert");
    const close = screen.getByRole("button", { name: "Dismiss notification" });
    fireEvent.mouseEnter(alert);
    act(() => { close.focus(); });
    fireEvent.mouseLeave(alert);   // still focused
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { close.blur(); });
    expectDismissedAt(6060, onDismiss, 8);
  });

  it("the dismiss button still works while paused", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[{ id: 9, message: "x" }]} onDismiss={onDismiss} />);
    fireEvent.mouseEnter(screen.getByRole("alert"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(9);
  });

  it("each toast keeps its own clock (a newer toast doesn't reset an older one)", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toasts items={[{ id: 1, message: "old" }]} onDismiss={onDismiss} />);
    // Both three characters long: 6180 ms each.
    act(() => { vi.advanceTimersByTime(4000); });
    rerender(<Toasts items={[{ id: 1, message: "old" }, { id: 2, message: "new" }]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(2180); });
    expect(onDismiss.mock.calls).toEqual([[1]]);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onDismiss.mock.calls).toEqual([[1], [2]]);
  });

  it("cancels the timer when a toast is removed early", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toasts items={[{ id: 1, message: "x" }]} onDismiss={onDismiss} />);
    rerender(<Toasts items={[]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("cancels the timer on unmount", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Toasts items={[{ id: 1, message: "x" }]} onDismiss={onDismiss} />);
    unmount();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
