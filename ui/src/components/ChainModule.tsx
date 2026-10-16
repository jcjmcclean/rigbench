import { Knob } from "./Knob";
import type { SlotState, SlotType } from "../types";
import { percent, dbFromUnit } from "../format";
import { soundLinks } from "../links";
import "./ChainModule.css";

// short: the slot's name in the bypass button's accessible name ("Amp ON"), so
// it includes the visible ON/OFF (WCAG 2.5.3) and says which slot it is.
// thing: what's loaded in it, for Change and Remove ("Remove amp model").
const META: Record<SlotType, { kind: string; role: string; short: string; thing: string; empty: string }> = {
  vst3: { kind: "VST3", role: "Plugin", short: "plugin", thing: "plugin", empty: "Load a plugin" },
  nam: { kind: "NAM", role: "Amp", short: "amp", thing: "amp model", empty: "Load an amp model" },
  ir: { kind: "IR", role: "Cab", short: "cab", thing: "cab IR", empty: "Load a cab IR" },
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
  onOpenUrl?: (url: string) => void;   // "where to get one" links on an empty slot
}

export function ChainModule({ slot, index, onLoad, onClear, onBypass, onMix, onGain, onEditor, onOpenUrl }: Props) {
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
          <span className={`module__led jewel${active ? " jewel--lit" : ""}`} aria-hidden />
          {slot.loaded && (
            // Named "Amp ON" / "Amp OFF": which slot (visually hidden) and its state
            // (visible), so voice control can use the word on screen.
            <button
              className="module__bypass"
              onClick={() => onBypass(!slot.bypassed)}
              title={slot.bypassed ? "Off: click to turn on" : "On: click to turn off"}
            >
              <span className="visually-hidden">{m.short[0].toUpperCase() + m.short.slice(1)} </span>
              {slot.bypassed ? "OFF" : "ON"}
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
                <Knob value={slot.mix ?? 1} onChange={onMix} label="Mix" size={64} format={percent} />
              )}
              {slot.type === "nam" && (
                <Knob value={slot.gain ?? 0.5} onChange={onGain} label="Level" size={64} format={dbFromUnit} />
              )}
              {slot.type === "vst3" && (
                <button className="module__editor" onClick={onEditor}>
                  <span className="module__editor-glyph" aria-hidden>⊞</span>
                  Open editor
                </button>
              )}
            </div>

            <button className="module__change" onClick={onLoad} aria-label={`Change ${m.thing}`}>Change</button>
            <button
              className="module__clear"
              onClick={onClear}
              aria-label={`Remove ${m.thing}`}
              title={`Remove ${m.thing}`}
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <button className="module__load" onClick={onLoad}>
              <span className="module__plus" aria-hidden>+</span>
              <span className="module__load-text">{m.empty}</span>
            </button>
            {onOpenUrl && (
              <div className="module__links">
                <span className="module__links-label">Don’t have one?</span>
                {soundLinks[slot.type].map((l) => (
                  <button key={l.url} className="module__link" onClick={() => onOpenUrl(l.url)}>{l.label}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </article>
  );
}
