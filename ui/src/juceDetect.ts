// Captures whether the REAL JUCE native backend is present, BEFORE anything
// imports juce-framework-frontend (whose import installs a placeholder
// window.__JUCE__ — complete with a stub `backend` — that would otherwise fool
// a naive check). This module imports nothing, so when it is evaluated first it
// sees the genuine state: a real backend only exists inside the JUCE WebView.
const w = typeof window !== "undefined" ? (window as unknown as { __JUCE__?: { backend?: unknown } }) : undefined;

export const hasRealJuceBackend = !!w && !!w.__JUCE__ && !!w.__JUCE__.backend;
