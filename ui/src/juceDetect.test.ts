import { afterEach, describe, expect, it, vi } from "vitest";

// juceDetect records whether the REAL JUCE native backend is present. Its whole
// contract is: it imports NOTHING (so it can be evaluated BEFORE
// juce-framework-frontend installs its placeholder window.__JUCE__) and it
// treats a stub __JUCE__ WITHOUT a `backend` as "not real". These tests pin that
// contract. Each case re-imports the module fresh (it caches its result in a
// top-level const) after seeding window.__JUCE__.

type JuceWin = typeof globalThis & {
  __JUCE__?: { backend?: object };
};

function clearJuce() {
  delete (globalThis as JuceWin).__JUCE__;
}

async function loadDetect() {
  vi.resetModules();
  return import("./juceDetect");
}

afterEach(() => {
  clearJuce();
});

describe("hasRealJuceBackend", () => {
  it("is false when window.__JUCE__ is absent (plain browser)", async () => {
    clearJuce();
    const { hasRealJuceBackend } = await loadDetect();
    expect(hasRealJuceBackend).toBe(false);
  });

  it("is false for a stub __JUCE__ that has no backend (the juce-import placeholder)", async () => {
    (globalThis as JuceWin).__JUCE__ = {};
    const { hasRealJuceBackend } = await loadDetect();
    expect(hasRealJuceBackend).toBe(false);
  });

  it("is true only when a real backend object is present", async () => {
    (globalThis as JuceWin).__JUCE__ = { backend: { addEventListener: () => 0 } };
    const { hasRealJuceBackend } = await loadDetect();
    expect(hasRealJuceBackend).toBe(true);
  });

  it("imports nothing that installs a placeholder __JUCE__ (ordering contract)", async () => {
    // Evaluating juceDetect first must NOT itself create window.__JUCE__ — that
    // is precisely why it can capture the genuine state before the Juce import
    // installs its stub backend.
    clearJuce();
    await loadDetect();
    expect((globalThis as JuceWin).__JUCE__).toBeUndefined();
  });
});
