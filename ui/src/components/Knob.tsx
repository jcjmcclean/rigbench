import { useCallback, useEffect, useId, useRef } from "react";
import "./Knob.css";

interface KnobProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  label?: string;
  size?: number;
  format?: (v: number) => string;
  disabled?: boolean;
}

const START = 225; // degrees, 7:30 position
const SWEEP = 270; // 270° arc, 90° gap at the bottom

export function Knob({
  value,
  min = 0,
  max = 1,
  onChange,
  label,
  size = 56,
  format,
  disabled = false,
}: KnobProps) {
  const id = useId();
  const dialRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));

  const commit = useCallback(
    (f: number) => onChange(min + Math.min(1, Math.max(0, f)) * (max - min)),
    [min, max, onChange],
  );

  // React's onWheel is passive, so it can't preventDefault — the stage would
  // scroll while adjusting a knob. Attach a non-passive native listener instead.
  // Keep the handler in a ref (updated in an effect, not during render) so it
  // always sees the latest value/commit without re-binding the listener.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (e: WheelEvent) => {
      if (disabled) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.03; // Shift for fine (as the footer hint advertises)
      commit(frac - Math.sign(e.deltaY) * step);
    };
  });
  useEffect(() => {
    const el = dialRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVal: frac };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dy = dragRef.current.startY - e.clientY;
    const fine = e.shiftKey ? 0.25 : 1;
    commit(dragRef.current.startVal + (dy / 180) * fine);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { commit(frac + step); e.preventDefault(); }
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") { commit(frac - step); e.preventDefault(); }
  };

  const C = 2 * Math.PI * 44;
  const fullArc = (SWEEP / 360) * C;
  const indicatorDeg = START + frac * SWEEP;
  const display = format ? format(value) : `${Math.round(frac * 100)}`;

  return (
    <div className={`knob ${disabled ? "knob--disabled" : ""}`} style={{ width: size }}>
      <div
        ref={dialRef}
        className="knob__dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuenow={Math.round(frac * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={display}
        aria-labelledby={label ? id : undefined}
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <circle className="knob__track" cx="50" cy="50" r="44"
            strokeDasharray={`${fullArc} ${C}`} transform="rotate(135 50 50)" />
          <circle className="knob__value" cx="50" cy="50" r="44"
            strokeDasharray={`${frac * fullArc} ${C}`} transform="rotate(135 50 50)" />
        </svg>
        <div className="knob__cap">
          <div className="knob__face" aria-hidden />
          <div className="knob__pointer" style={{ transform: `rotate(${indicatorDeg}deg)` }} />
        </div>
      </div>
      {label && (
        <div className="knob__meta">
          <span className="knob__label eyebrow" id={id}>{label}</span>
          <span className="knob__value-text mono">{display}</span>
        </div>
      )}
    </div>
  );
}
