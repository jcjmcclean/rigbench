import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Modal } from "./Modal";

// jsdom does no layout, so every element's offsetParent is null and Modal's
// focus-trap would see nothing as "visible". Treat attached elements as visible.
let offsetParentDesc: PropertyDescriptor | undefined;
beforeEach(() => {
  offsetParentDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) { return this.isConnected ? this.parentElement : null; },
  });
});
afterEach(() => {
  if (offsetParentDesc) Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParentDesc);
});

function Form({ onClose = () => {} }: { onClose?: () => void }) {
  return (
    <Modal title="Save current rig" onClose={onClose}>
      <input placeholder="Preset name" />
      <button>Cancel</button>
      <button>Save</button>
    </Modal>
  );
}

describe("Modal semantics", () => {
  it("is an aria-modal dialog named by its title", () => {
    render(<Form />);
    const dialog = screen.getByRole("dialog", { name: "Save current rig" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(screen.getByPlaceholderText("Preset name"));
  });
});

describe("Modal focus management", () => {
  it("moves focus to the first input on open", () => {
    render(<Form />);
    expect(screen.getByPlaceholderText("Preset name")).toHaveFocus();
  });

  it("falls back to the first button when there is no input", () => {
    render(
      <Modal title="Confirm" onClose={() => {}}>
        <button>OK</button>
        <button>Cancel</button>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "OK" })).toHaveFocus();
  });

  it("focuses the dialog itself when it has nothing focusable", () => {
    render(<Modal title="Info" onClose={() => {}}><p>Hello</p></Modal>);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("restores focus to the element that opened it on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && <Form onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByPlaceholderText("Preset name")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("does not steal focus back when the parent re-renders (e.g. a 30 Hz meter tick)", () => {
    // The parent passes a fresh inline onClose on every render. The user has
    // tabbed to "Cancel"; a re-render must not yank focus back to the input,
    // or pressing Enter would hit the input (and save) instead of Cancel.
    const { rerender } = render(<Form onClose={() => {}} />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    rerender(<Form onClose={() => {}} />);
    rerender(<Form onClose={() => {}} />);
    expect(cancel).toHaveFocus();
  });

  it("still calls the latest onClose after re-renders", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<Form onClose={first} />);
    rerender(<Form onClose={latest} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("Modal keyboard", () => {
  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    const notCancelled = fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(false);
  });

  it("other keys don't close", () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    fireEvent.keyDown(document.activeElement!, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Form onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Tab from the last item wraps to the first", () => {
    render(<Form />);
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    expect(fireEvent.keyDown(save, { key: "Tab" })).toBe(false);
    expect(screen.getByPlaceholderText("Preset name")).toHaveFocus();
  });

  it("Shift+Tab from the first item wraps to the last", () => {
    render(<Form />);
    const input = screen.getByPlaceholderText("Preset name");
    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(false);
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });

  it("Tab between middle items is left to the browser", () => {
    render(<Form />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    expect(fireEvent.keyDown(cancel, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true })).toBe(true);
  });

  it("pulls focus back inside if it escaped the dialog", () => {
    render(
      <>
        <button>Outside</button>
        <Form />
      </>,
    );
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(screen.getByPlaceholderText("Preset name")).toHaveFocus();
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });

  it("swallows Tab when there is nothing focusable", () => {
    render(<Modal title="Info" onClose={() => {}}><p>Hello</p></Modal>);
    expect(fireEvent.keyDown(document.activeElement!, { key: "Tab" })).toBe(false);
  });
});

describe("Modal backdrop", () => {
  it("pressing on the backdrop closes", () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    const scrim = screen.getByRole("dialog").parentElement!;
    fireEvent.mouseDown(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pressing inside the dialog does not close", () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    fireEvent.mouseDown(screen.getByPlaceholderText("Preset name"));
    fireEvent.mouseDown(screen.getByRole("button", { name: "Save" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
