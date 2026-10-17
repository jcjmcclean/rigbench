// Website only: listens to the visitor's microphone and feeds the browser
// preview's tuner, so people can try it with their own guitar. The sound only
// goes into the pitch detector; nothing is recorded or sent anywhere.
import { describe, detectPitch, windowFor } from "./pitch";
import type { TunerReading } from "./types";

// About as often as the engine sends readings.
export const READ_EVERY_MS = 40;

// Starts listening and calls onReading with each reading (null between notes).
// Resolves to a function that stops listening and lets go of the microphone;
// rejects if there's no microphone or the visitor says no.
export async function startMicTuner(onReading: (r: TunerReading | null) => void): Promise<() => void> {
  // Made before asking for the microphone, while we're still inside the click
  // that started this: browsers only let audio start from one, and the
  // permission prompt can outlast it.
  const ctx = new AudioContext();
  void ctx.resume();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // A tuner wants the raw string: these would treat it as speech or noise.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    void ctx.close();
    throw e;
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = windowFor(ctx.sampleRate);
  ctx.createMediaStreamSource(stream).connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const hz = detectPitch(samples, ctx.sampleRate);
    onReading(hz > 0 ? describe(hz) : null);
  }, READ_EVERY_MS);

  return () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}
