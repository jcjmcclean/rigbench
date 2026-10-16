import { Knob } from "./Knob";
import type { SlotState, SlotType } from "../types";
import "./ChainModule.css";

const META: Record<SlotType, { kind: string; role: string; empty: string }> = {
  vst3: { kind: "VST3", role: "Plugin", empty: "Load a plugin" },
  nam: { kind: "NAM", role: "Amp", empty: "Load an amp model" },
  ir: { kind: "IR", role: "Cab", empty: "Load a cab IR" },
};

interface Props {
  slot: SlotState;
  index: number;
  onLoad: () => void;
  onClear: () => void;
  onBypass: (b: boolean) => void;
  onMix: (v: number) => void;
  onGain: (v: number) => void;
  onEditor: () => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => {
  const d = (v - 0.5) * 48;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)} dB`;
};

export function ChainModule({ slot, index, onLoad, onClear, onBypass, onMix, onGain, onEditor }: Props) {
  const m = META[slot.type];
  const active = slot.loaded && !slot.bypassed;
  const cls = [
    "module",
    `module--${slot.type}`,
    slot.loaded ? "is-loaded" : "is-empty",
    slot.bypassed ? "is-bypassed" : "",
    active ? "is-active" : "",
  ].join(" ");

  return (
    <article className={cls} style={{ ["--i" as string]: index }}>
      <span className="module__bridge" aria-hidden />
      <div className="module__panel">
      <header className="module__head">
        <div className="module__id">
          <span className="module__kind">{m.kind}</span>
          <span className="module__role eyebrow">{m.role}</span>
        </div>
        <div className="module__head-right">
          <span className="module__led" aria-hidden />
          {slot.loaded && (
            <button
              className="module__bypass"
              aria-pressed={slot.bypassed}
              onClick={() => onBypass(!slot.bypassed)}
              title={slot.bypassed ? "Bypassed — click to engage" : "Engaged — click to bypass"}
            >
              {slot.bypassed ? "BYP" : "ON"}
            </button>
          )}
        </div>
      </header>

      <div className="module__body">
        {slot.loaded ? (
          <>
            <div className="module__name" title={slot.name}>{slot.name}</div>

            <div className="module__controls">
              {slot.type === "ir" && (
                <Knob value={slot.mix ?? 1} onChange={onMix} label="Mix" size={64} format={pct} />
              )}
              {slot.type === "nam" && (
                <Knob value={slot.gain ?? 0.5} onChange={onGain} label="Level" size={64} format={db} />
              )}
              {slot.type === "vst3" && (
                <button className="module__editor" onClick={onEditor}>
                  <span className="module__editor-glyph" aria-hidden>⊞</span>
                  Open editor
                </button>
              )}
            </div>

            <button className="module__change" onClick={onLoad}>Change</button>
            <button className="module__clear" onClick={onClear} title="Remove">✕</button>
          </>
        ) : (
          <button className="module__load" onClick={onLoad}>
            <span className="module__plus" aria-hidden>+</span>
            <span className="module__load-text">{m.empty}</span>
          </button>
        )}
      </div>
      </div>
    </article>
  );
}
