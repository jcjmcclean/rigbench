// Captures whether the REAL JUCE native backend is present, BEFORE anything
// imports juce-framework-frontend (whose import installs a placeholder
// window.__JUCE__ — complete with a stub `backend` — that would otherwise fool
// a naive check). This module imports nothing, so when it is evaluated first it
// sees the genuine state: a real backend only exists inside the JUCE WebView.
// window.__JUCE__ is typed globally in juce-framework-frontend.d.ts.
export const hasRealJuceBackend =
  typeof window !== "undefined" && !!window.__JUCE__ && !!window.__JUCE__.backend;
