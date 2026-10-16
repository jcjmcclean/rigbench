import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bridge, EngineState, SlotState, SlotType } from "./types";

// The JS <-> C++ bridge contract lives in tests/contract/bridge.json; the C++
// side (tests/MiscTests.cpp) checks itself against the same file. This test
// pins the JS side: bridge.ts's native function names and event ids, the mock
// engine's state shape, and the EngineState/SlotState types. Changing any one of
// them without the contract (and C++) fails here.

const here = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  readFileSync(resolve(here, "../../tests/contract/bridge.json"), "utf8"),
) as {
  nativeFunctions: string[];
  events: string[];
  stateKeys: string[];
  slotIds: string[];
  slotKeys: Record<string, string[]>;
  meterKeys: string[];
  errorKeys: string[];
};
const bridgeSrc = readFileSync(resolve(here, "bridge.ts"), "utf8");
const typesSrc = readFileSync(resolve(here, "types.ts"), "utf8");

const sorted = (xs: Iterable<string>) => [...xs].sort();

// Compare as sets and report what's missing/extra, so a drift reads clearly
// ("JS lacks finishSetup") instead of as two long arrays.
function expectSameSet(actual: Iterable<string>, expected: Iterable<string>, what: string) {
  const a = new Set(actual);
  const e = new Set(expected);
  expect(
    { missingFromJs: sorted([...e].filter((x) => !a.has(x))), notInContract: sorted([...a].filter((x) => !e.has(x))) },
    what,
  ).toEqual({ missingFromJs: [], notInContract: [] });
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ---- Compile-time exhaustive key lists (checked by `tsc -b`) -----------------
// Adding a key to EngineState/SlotState/SlotType without listing it here (or
// listing one that doesn't exist) is a type error; the runtime checks below then
// compare these lists with the contract.
type Exact<List extends readonly PropertyKey[], Keys extends PropertyKey> =
  [Exclude<Keys, List[number]>] extends [never] ? ([Exclude<List[number], Keys>] extends [never] ? true : never) : never;

const ENGINE_STATE_KEYS = [
  "device", "sampleRate", "bufferSize", "roundTripMs", "setupComplete", "monitoring", "inputGain", "masterGain", "gate",
  "playing", "inputLevel", "outputLevel", "slots", "presets", "activePreset",
] as const;
const engineStateExact: Exact<typeof ENGINE_STATE_KEYS, keyof EngineState> = true;

const SLOT_STATE_KEYS = ["type", "loaded", "name", "bypassed", "mix", "gain", "hasEditor"] as const;
const slotStateExact: Exact<typeof SLOT_STATE_KEYS, keyof SlotState> = true;

const SLOT_TYPES = ["vst3", "nam", "ir"] as const;
const slotTypesExact: Exact<typeof SLOT_TYPES, SlotType> = true;

const SUBSCRIPTIONS = [
  "subscribe", "subscribeScope", "subscribeError", "subscribeInputPeaks", "subscribeShowSettings", "subscribeTuner",
] as const;
type BridgeAction = Exclude<keyof Bridge, (typeof SUBSCRIPTIONS)[number]>;
const BRIDGE_ACTIONS = [
  "getState", "loadSlot", "clearSlot", "setBypass", "setMix", "setGain", "setInput", "setMaster",
  "setMonitor", "setGate", "setTuner", "openEditor", "savePreset", "loadPreset", "renamePreset", "deletePreset",
  "getAudioSetup", "setAudioSetup", "playTestSound", "finishSetup", "openUrl",
] as const;
const bridgeActionsExact: Exact<typeof BRIDGE_ACTIONS, BridgeAction> = true;

// ---- Source-text parsing (fails under plain `vitest`, no tsc needed) --------
function interfaceKeys(name: string): string[] {
  const m = stripComments(typesSrc).match(new RegExp(`interface ${name}\\s*{([\\s\\S]*?)\\n}`));
  if (!m) throw new Error(`interface ${name} not found in types.ts`);
  return [...m[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\??\s*[:(]/gm)].map((x) => x[1]);
}
function juceBridgeSource(): string {
  const start = bridgeSrc.indexOf("function createJuceBridge(");
  const end = bridgeSrc.indexOf("\nexport const bridge", start);
  if (start < 0 || end < 0) throw new Error("createJuceBridge not found in bridge.ts");
  return stripComments(bridgeSrc.slice(start, end));
}

// ---- Runtime: import bridge.ts against a fake JUCE backend -------------------
const { getNativeFunctionMock } = vi.hoisted(() => ({
  getNativeFunctionMock: vi.fn((_name: string) => vi.fn(() => new Promise(() => {}))),
}));
vi.mock("juce-framework-frontend", () => ({ getNativeFunction: getNativeFunctionMock }));

type JuceWin = typeof globalThis & { __JUCE__?: { backend?: unknown } };
afterEach(() => { delete (globalThis as JuceWin).__JUCE__; });

async function loadRealBridge() {
  const events: string[] = [];
  (globalThis as JuceWin).__JUCE__ = {
    backend: {
      addEventListener: (id: string) => { events.push(id); return events.length; },
      removeEventListener: () => {},
    },
  };
  vi.resetModules();
  const mod = await import("./bridge");
  return { ...mod, events, natives: getNativeFunctionMock.mock.calls.map(([n]) => n) };
}

async function loadMockBridge() {
  delete (globalThis as JuceWin).__JUCE__;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.resetModules();
  const mod = await import("./bridge");
  return mod;
}

describe("contract file", () => {
  it("is well-formed", () => {
    for (const k of ["nativeFunctions", "events", "stateKeys", "slotIds", "meterKeys", "errorKeys"] as const) {
      expect(Array.isArray(contract[k]), k).toBe(true);
      expect(new Set(contract[k]).size, `${k} has duplicates`).toBe(contract[k].length);
    }
    expect(Object.keys(contract.slotKeys).sort()).toEqual(["common", ...contract.slotIds].sort());
  });
});

describe("native functions", () => {
  it('createJuceBridge registers exactly contract.nativeFunctions via fn("...")', () => {
    const names = [...juceBridgeSource().matchAll(/\bfn\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    expectSameSet(names, contract.nativeFunctions, "fn(...) in createJuceBridge vs contract.nativeFunctions");
  });

  it("at runtime the real bridge asks JUCE for exactly those functions", async () => {
    getNativeFunctionMock.mockClear();
    const { natives, isMock } = await loadRealBridge();
    expect(isMock).toBe(false);
    expectSameSet(natives, contract.nativeFunctions, "getNativeFunction calls vs contract.nativeFunctions");
  });

  it("the Bridge interface's actions are exactly the native functions", () => {
    expect(bridgeActionsExact).toBe(true);
    expectSameSet(BRIDGE_ACTIONS, contract.nativeFunctions, "BRIDGE_ACTIONS vs contract.nativeFunctions");
    const methods = interfaceKeys("Bridge").filter((k) => !(SUBSCRIPTIONS as readonly string[]).includes(k));
    expectSameSet(methods, contract.nativeFunctions, "Bridge interface (types.ts) vs contract.nativeFunctions");
  });

  it("both bridge implementations expose every action plus the subscriptions", async () => {
    const expected = sorted([...contract.nativeFunctions, ...SUBSCRIPTIONS]);
    const real = await loadRealBridge();
    expect(sorted(Object.keys(real.bridge))).toEqual(expected);
    try {
      const mock = await loadMockBridge();
      expect(mock.isMock).toBe(true);
      expect(sorted(Object.keys(mock.bridge))).toEqual(expected);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe("events", () => {
  it('createJuceBridge listens via addEventListener("...") to exactly contract.events', () => {
    const ids = [...juceBridgeSource().matchAll(/addEventListener\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expectSameSet(ids, contract.events, "addEventListener(...) in createJuceBridge vs contract.events");
  });

  it("at runtime the real bridge subscribes to exactly those events", async () => {
    const { bridge, events } = await loadRealBridge();
    bridge.subscribeScope(() => {});        // these listeners are attached on demand
    bridge.subscribeShowSettings(() => {});
    expectSameSet(events, contract.events, "backend listeners vs contract.events");
  });

  it("the error payload keys are what errorMessage reads", async () => {
    const { errorMessage } = await loadRealBridge();
    expect(contract.errorKeys).toEqual(["message"]);
    const payload = Object.fromEntries(contract.errorKeys.map((k) => [k, "boom"]));
    expect(errorMessage(payload)).toBe("boom");
  });
});

describe("state shape", () => {
  it("EngineState in types.ts has exactly contract.stateKeys", () => {
    expect(engineStateExact).toBe(true);
    expectSameSet(ENGINE_STATE_KEYS, contract.stateKeys, "ENGINE_STATE_KEYS vs contract.stateKeys");
    expectSameSet(interfaceKeys("EngineState"), contract.stateKeys, "EngineState (types.ts) vs contract.stateKeys");
  });

  it("the mock engine's initial state has exactly contract.stateKeys", async () => {
    try {
      const { bridge } = await loadMockBridge();
      const state = await bridge.getState();
      expectSameSet(Object.keys(state), contract.stateKeys, "mock engine state vs contract.stateKeys");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("SlotType in types.ts is exactly contract.slotIds", () => {
    expect(slotTypesExact).toBe(true);
    expect(sorted(SLOT_TYPES)).toEqual(sorted(contract.slotIds));
    const union = stripComments(typesSrc).match(/type SlotType\s*=\s*([^;]+);/)![1];
    expect(sorted([...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]))).toEqual(sorted(contract.slotIds));
  });

  it("SlotState in types.ts has the common keys plus every slot-specific key", () => {
    const all = [...contract.slotKeys.common, ...contract.slotIds.flatMap((id) => contract.slotKeys[id])];
    expect(slotStateExact).toBe(true);
    expect(sorted(SLOT_STATE_KEYS)).toEqual(sorted(all));
    expect(sorted(interfaceKeys("SlotState"))).toEqual(sorted(all));
  });

  it("each mock slot has exactly the common keys plus its own", async () => {
    try {
      const { bridge } = await loadMockBridge();
      const state = await bridge.getState();
      expect(sorted(Object.keys(state.slots))).toEqual(sorted(contract.slotIds));
      for (const id of contract.slotIds) {
        const slot = state.slots[id as SlotType];
        expect(sorted(Object.keys(slot)), id).toEqual(sorted([...contract.slotKeys.common, ...contract.slotKeys[id]]));
        expect(slot.type).toBe(id);
      }
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
