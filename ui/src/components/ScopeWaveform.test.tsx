import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { fake } from "../test/fakeBridge";
import { ScopeWaveform } from "./ScopeWaveform";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

// jsdom has no canvas, layout, Path2D or (controllable) rAF, so stub them:
// - Path2D records the waveform's points (that's the "points -> path" contract),
// - getContext returns a recording 2D context,
// - the canvas reports a W x H layout box,
// - rAF frames run only when the test calls frame().
const W = 100;
const H = 40;
const MID = H / 2;
const AMP = H * 0.42;

let paths: Array<Array<[number, number]>>;
let ctx: Record<string, ReturnType<typeof vi.fn>> & { createLinearGradient: ReturnType<typeof vi.fn> };
let rafQueue: Map<number, FrameRequestCallback>;
let nextRaf: number;
let size = { w: W, h: H };

class FakePath2D {
  pts: Array<[number, number]> = [];
  constructor() { paths.push(this.pts); }
  moveTo(x: number, y: number) { this.pts.push([x, y]); }
  lineTo(x: number, y: number) { this.pts.push([x, y]); }
}

function frame(ts = 0) {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  cbs.forEach((cb) => cb(ts));
}
const lastPath = () => paths[paths.length - 1];
const ys = () => lastPath().map(([, y]) => y);

beforeEach(() => {
  fake.reset();
  paths = [];
  rafQueue = new Map();
  nextRaf = 1;
  size = { w: W, h: H };
  const methods = ["setTransform", "clearRect", "beginPath", "moveTo", "lineTo", "closePath", "fill", "stroke", "arc"];
  ctx = Object.fromEntries(methods.map((m) => [m, vi.fn()])) as typeof ctx;
  ctx.createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
  vi.stubGlobal("Path2D", FakePath2D);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { const id = nextRaf++; rafQueue.set(id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { rafQueue.delete(id); }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => size.w);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => size.h);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ScopeWaveform canvas", () => {
  it("is decorative (hidden from assistive tech)", () => {
    const { container } = render(<ScopeWaveform />);
    expect(container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
  });

  it("sizes the backing store to the layout box x devicePixelRatio (capped at 2)", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const { container } = render(<ScopeWaveform />);
    frame();
    const canvas = container.querySelector("canvas")!;
    expect(canvas.width).toBe(W * 2);
    expect(canvas.height).toBe(H * 2);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  it("skips drawing while it has no size (e.g. hidden on mobile)", () => {
    size = { w: 0, h: 0 };
    render(<ScopeWaveform />);
    frame();
    expect(paths).toHaveLength(0);
    expect(ctx.clearRect).not.toHaveBeenCalled();
    expect(rafQueue.size).toBe(1); // keeps polling for a size
  });
});

describe("ScopeWaveform samples -> path", () => {
  it("one point per pixel column, left to right", () => {
    render(<ScopeWaveform />);
    frame();
    expect(lastPath()).toHaveLength(W + 1);
    expect(lastPath().map(([x]) => x)).toEqual(Array.from({ length: W + 1 }, (_, i) => i));
  });

  it("is a flat line on the midline with no samples (silence)", () => {
    render(<ScopeWaveform />);
    frame();
    expect(new Set(ys())).toEqual(new Set([MID]));
  });

  it("is still flat for an all-zero batch", () => {
    render(<ScopeWaveform />);
    act(() => fake.emitScope(new Array(48).fill(0)));
    frame();
    expect(new Set(ys())).toEqual(new Set([MID]));
  });

  it("draws the newest sample at the left edge, older samples to the right", () => {
    render(<ScopeWaveform />);
    fake.emitScope([1]);
    frame();
    const y = ys();
    expect(y[0]).toBeCloseTo(MID - AMP, 6); // full-scale positive: up
    expect(y.slice(1).every((v) => v === MID)).toBe(true);
  });

  it("negative samples go below the midline", () => {
    render(<ScopeWaveform />);
    fake.emitScope([-1]);
    frame();
    expect(ys()[0]).toBeCloseTo(MID + AMP, 6);
  });

  it("compresses amplitude perceptually (sqrt): 0.25 draws at half height", () => {
    render(<ScopeWaveform />);
    fake.emitScope([0.25]);
    frame();
    expect(ys()[0]).toBeCloseTo(MID - 0.5 * AMP, 6);
    fake.emitScope([-0.25]);
    frame();
    expect(ys()[0]).toBeCloseTo(MID + 0.5 * AMP, 6);
  });

  it("scrolls: earlier samples move right as new ones arrive", () => {
    render(<ScopeWaveform />);
    // The ring (300) is decimated across the width (100px), so use a short burst.
    fake.emitScope([1, 1, 1, 1, 1]);
    fake.emitScope(new Array(150).fill(0)); // 150 newer samples push the burst to mid-width
    frame();
    const y = ys();
    const spikeX = y.findIndex((v) => v < MID);
    expect(spikeX).toBeGreaterThan(40);
    expect(spikeX).toBeLessThan(60);
    expect(y[0]).toBe(MID);
  });

  it("keeps only the last 300 samples (ring buffer wraps)", () => {
    render(<ScopeWaveform />);
    fake.emitScope([1]);
    fake.emitScope(new Array(300).fill(0)); // the spike is overwritten
    frame();
    expect(new Set(ys())).toEqual(new Set([MID]));
  });

  it("redraws every animation frame", () => {
    render(<ScopeWaveform />);
    frame();
    frame();
    frame();
    expect(paths).toHaveLength(3);
    expect(ctx.stroke).toHaveBeenCalledWith(expect.any(FakePath2D));
  });
});

describe("ScopeWaveform lifecycle", () => {
  it("subscribes to the scope feed and unsubscribes on unmount", () => {
    const { unmount } = render(<ScopeWaveform />);
    expect(fake.counts().scope).toBe(1);
    unmount();
    expect(fake.counts().scope).toBe(0);
  });

  it("stops the animation loop on unmount", () => {
    const { unmount } = render(<ScopeWaveform />);
    expect(rafQueue.size).toBe(1);
    unmount();
    expect(rafQueue.size).toBe(0);
  });
});

describe("ScopeWaveform reduced motion", () => {
  function stubMatchMedia(initial: boolean) {
    const mq = {
      matches: initial,
      listeners: new Set<() => void>(),
      addEventListener: vi.fn((_: string, cb: () => void) => mq.listeners.add(cb)),
      removeEventListener: vi.fn((_: string, cb: () => void) => mq.listeners.delete(cb)),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mq));
    return mq;
  }

  it("draws one static midline and runs no animation loop", () => {
    stubMatchMedia(true);
    render(<ScopeWaveform />);
    expect(rafQueue.size).toBe(0);
    expect(paths).toHaveLength(0);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, MID);
    expect(ctx.lineTo).toHaveBeenCalledWith(W, MID);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it("follows live changes to the OS setting", () => {
    const mq = stubMatchMedia(false);
    const { unmount } = render(<ScopeWaveform />);
    expect(rafQueue.size).toBe(1);
    act(() => { mq.matches = true; mq.listeners.forEach((cb) => cb()); });
    expect(rafQueue.size).toBe(0); // loop cancelled
    expect(ctx.lineTo).toHaveBeenCalledWith(W, MID);
    act(() => { mq.matches = false; mq.listeners.forEach((cb) => cb()); });
    expect(rafQueue.size).toBe(1); // loop resumed
    unmount();
    expect(mq.listeners.size).toBe(0);
  });
});
