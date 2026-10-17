// How the tuner turns a reading into its display.
import type { TunerReading } from "./types";

// Within this many cents counts as in tune.
export const IN_TUNE_CENTS = 3;

// A row of LEDs like a tuner pedal's, 5 cents each from -50 to +50. The middle
// one lights only when you're in tune, so a reading just outside that lights its
// neighbour instead.
export const LEDS = 21;
export const MIDDLE_LED = (LEDS - 1) / 2;

export const isInTune = (r: TunerReading | null) => r !== null && Math.abs(r.cents) <= IN_TUNE_CENTS;

export function litLed(cents: number): number {
  if (Math.abs(cents) <= IN_TUNE_CENTS) return MIDDLE_LED;
  const i = Math.max(0, Math.min(LEDS - 1, Math.round(cents / 5) + MIDDLE_LED));
  return i !== MIDDLE_LED ? i : MIDDLE_LED + Math.sign(cents);
}
