import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Toasts, type ToastItem } from "./Toast";

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

  it("dismisses itself after 6 seconds, not before", () => {
    const onDismiss = vi.fn();
    render(<Toasts items={[{ id: 3, message: "x" }]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(5999); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("each toast keeps its own clock (a newer toast doesn't reset an older one)", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toasts items={[{ id: 1, message: "old" }]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(4000); });
    rerender(<Toasts items={[{ id: 1, message: "old" }, { id: 2, message: "new" }]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(2000); });
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
