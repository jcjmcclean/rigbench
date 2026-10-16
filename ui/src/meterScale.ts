// The level meters show dBFS, not amplitude, so a normal guitar level (around
// -18 dB) sits well up the scale instead of lighting one segment.

// The bottom of the scale.
export const METER_FLOOR_DB = -60;

// Peak amplitude (1 = 0 dBFS) -> 0..1 position on the meter.
export function meterPosition(amplitude: number): number {
  if (!(amplitude > 0)) return 0;
  const db = 20 * Math.log10(amplitude);
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}
