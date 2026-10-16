import "./Meter.css";

interface MeterProps {
  value: number;         // 0..1
  label?: string;
  segments?: number;
  orientation?: "v" | "h";
}

export function Meter({ value, label, segments = 14, orientation = "v" }: MeterProps) {
  const lit = Math.round(Math.min(1, Math.max(0, value)) * segments);
  const cells = Array.from({ length: segments }, (_, i) => {
    // index from the "quiet" end
    const idx = orientation === "v" ? segments - 1 - i : i;
    const level = (idx + 1) / segments;
    const on = idx < lit;
    const zone = level > 0.88 ? "clip" : level > 0.72 ? "warn" : "ok";
    return <span key={i} className={`meter__seg meter__seg--${zone} ${on ? "is-on" : ""}`} />;
  });

  return (
    <div className={`meter meter--${orientation}`}>
      <div className="meter__track">{cells}</div>
      {label && <span className="meter__label eyebrow">{label}</span>}
    </div>
  );
}
