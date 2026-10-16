import { meterPosition } from "../meterScale";
import "./Meter.css";

interface MeterProps {
  value: number;         // peak amplitude, 0..1 (1 = 0 dBFS)
  label?: string;
  segments?: number;
  orientation?: "v" | "h";
}

export function Meter({ value, label, segments = 14, orientation = "v" }: MeterProps) {
  const lit = Math.round(meterPosition(value) * segments);
  const cells = Array.from({ length: segments }, (_, i) => {
    // index from the "quiet" end
    const idx = orientation === "v" ? segments - 1 - i : i;
    const level = (idx + 1) / segments;
    const on = idx < lit;
    // warn from about -12 dB, clip from about -3 dB
    const zone = level > 0.95 ? "clip" : level > 0.8 ? "warn" : "ok";
    return <span key={i} className={`meter__seg meter__seg--${zone} ${on ? "is-on" : ""}`} />;
  });

  return (
    <div className={`meter meter--${orientation}`}>
      <div className="meter__track">{cells}</div>
      {label && <span className="meter__label eyebrow">{label}</span>}
    </div>
  );
}
