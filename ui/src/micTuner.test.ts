import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READ_EVERY_MS, startMicTuner } from "./micTuner";

// A stand-in for the browser's audio: the "microphone" plays whatever tone the
// test sets, at 48 kHz.
let tone = 0;
const track = { stop: vi.fn() };
const close = vi.fn(async () => {});
let asked: MediaStreamConstraints | undefined;
let fftSize = 0;

class FakeAudioContext {
  sampleRate = 48000;
  close = close;
  resume = vi.fn(async () => {});
  createAnalyser() {
    return {
      set fftSize(n: number) { fftSize = n; },
      get fftSize() { return fftSize; },
      getFloatTimeDomainData(out: Float32Array) {
        for (let i = 0; i < out.length; i++) out[i] = tone ? 0.3 * Math.sin((2 * Math.PI * tone * i) / 48000) : 0;
      },
    };
  }
  createMediaStreamSource() { return { connect() {} }; }
}

beforeEach(() => {
  vi.useFakeTimers();
  tone = 0;
  asked = undefined;
  track.stop.mockClear();
  close.mockClear();
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async (c: MediaStreamConstraints) => {
        asked = c;
        return { getTracks: () => [track] };
      }),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startMicTuner", () => {
  it("asks for the raw microphone, without speech processing", async () => {
    await startMicTuner(() => {});
    expect(asked).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    expect(fftSize).toBe(4096);   // two periods of the lowest note at 48 kHz
  });

  it("reads the note it hears, and null when it's quiet", async () => {
    const readings: unknown[] = [];
    await startMicTuner((r) => readings.push(r));

    vi.advanceTimersByTime(READ_EVERY_MS);
    expect(readings.at(-1)).toBeNull();

    tone = 110;
    vi.advanceTimersByTime(READ_EVERY_MS);
    expect(readings.at(-1)).toMatchObject({ note: "A", octave: 2 });

    tone = 82.41 * 2 ** (-12 / 1200);
    vi.advanceTimersByTime(READ_EVERY_MS);
    const r = readings.at(-1) as { note: string; cents: number };
    expect(r.note).toBe("E");
    expect(r.cents).toBeCloseTo(-12, 0);
  });

  it("stopping lets go of the microphone and stops reading", async () => {
    const onReading = vi.fn();
    const stop = await startMicTuner(onReading);
    vi.advanceTimersByTime(READ_EVERY_MS * 3);
    const calls = onReading.mock.calls.length;

    stop();
    expect(track.stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    vi.advanceTimersByTime(READ_EVERY_MS * 3);
    expect(onReading).toHaveBeenCalledTimes(calls);
  });

  it("fails, and lets go of the audio, if the visitor says no", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const onReading = vi.fn();
    await expect(startMicTuner(onReading)).rejects.toThrow("denied");
    expect(close).toHaveBeenCalled();
    vi.advanceTimersByTime(READ_EVERY_MS * 3);
    expect(onReading).not.toHaveBeenCalled();
  });
});
