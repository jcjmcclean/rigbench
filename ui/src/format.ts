// Shared number formatters for knob/value readouts.
//
// NOTE: the ×48 dB mapping in `dbFromUnit` MUST stay in sync with the C++
// engine's `NamNode.h`: `setOutputTrimDb((v01 - 0.5f) * 48.0f)`. Change one
// without the other and the displayed value no longer matches the engine.

// Unit [0..1] -> integer percent, no suffix (e.g. 0.8 -> "80").
export const pct01 = (v: number) => `${Math.round(v * 100)}`;

// Unit [0..1] -> integer percent with suffix (e.g. 1 -> "100%").
export const percent = (v: number) => `${Math.round(v * 100)}%`;

// Unit [0..1] -> signed dB trim, centred at 0.5 (e.g. 0.5 -> "+0 dB").
export const dbFromUnit = (v: number) => {
  const d = (v - 0.5) * 48;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)} dB`;
};
