declare module "juce-framework-frontend" {
  export function getNativeFunction(name: string): (...args: unknown[]) => Promise<unknown>;
  export function getSliderState(name: string): unknown;
  export function getToggleState(name: string): unknown;
  export function getComboBoxState(name: string): unknown;
  export function getBackendResourceAddress(path: string): string;
}

// The JUCE WebView exposes its native backend on `window.__JUCE__`. Declared
// once here so bridge.ts and juceDetect.ts share one typed shape. Only a real
// JUCE WebView provides `backend`; in a plain browser `__JUCE__` is absent (or
// a stub with no backend — see juceDetect.ts).
interface JuceBackend {
  addEventListener: (eventId: string, cb: (payload: unknown) => void) => number;
  removeEventListener?: (token: number) => void;
}

interface Window {
  __JUCE__?: {
    backend?: JuceBackend;
  };
}
