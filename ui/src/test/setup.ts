// Global Vitest setup (see vitest.config.ts `setupFiles`).
//
// - jest-dom matchers (toBeInTheDocument, toHaveFocus, ...).
// - Testing Library's auto-cleanup only registers when test globals are on, and
//   this project imports `describe/it` explicitly, so unmount after every test.
// - jsdom lacks PointerEvent and Element#setPointerCapture; the Knob's drag path
//   needs both. The polyfills are inert stand-ins (tests spy on them as needed).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};
  Element.prototype.hasPointerCapture = function () { return false; };
}
