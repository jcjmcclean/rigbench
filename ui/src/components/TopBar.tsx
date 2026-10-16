import { PresetMenu } from "./PresetMenu";
import { bridge } from "../bridge";
import type { EngineState } from "../types";
import "./TopBar.css";

function Telem({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="telem">
      <span className="telem__label">{label}</span>
      <span className={`telem__value mono ${tone ? `telem__value--${tone}` : ""}`}>{value}</span>
    </div>
  );
}

export function TopBar({ state, dirty }: { state: EngineState; dirty: boolean }) {
  const latTone = state.roundTripMs < 12 ? "good" : state.roundTripMs < 20 ? "warn" : "bad";
  // Pair the colour with a word so the status isn't colour-only.
  const latWord = latTone === "good" ? "low" : latTone === "warn" ? "med" : "high";

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark" aria-hidden />
        <span className="topbar__word">Tone<em>Stack</em></span>
      </div>

      <div className="topbar__telemetry">
        <Telem label="Device" value={state.device} />
        <span className="topbar__sep" />
        <Telem label="Rate" value={`${(state.sampleRate / 1000).toFixed(1)} kHz`} />
        <Telem label="Buffer" value={`${state.bufferSize}`} />
        <Telem label="Latency" value={`${state.roundTripMs.toFixed(1)} ms · ${latWord}`} tone={latTone} />
      </div>

      <div className="topbar__actions">
        <PresetMenu presets={state.presets} active={state.activePreset} dirty={dirty} />
        <button
          className={`transport ${state.monitoring ? "is-live" : ""}`}
          onClick={() => bridge.setMonitor(!state.monitoring)}
          title={state.monitoring ? "Monitoring on — click to mute" : "Monitoring off"}
        >
          <span className={`transport__dot jewel${state.monitoring ? " jewel--lit" : ""}`} />
          {state.monitoring ? "Live" : "Muted"}
        </button>
        <button className="iconbtn" onClick={() => bridge.openAudioSettings()} title="Audio settings" aria-label="Audio settings">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.9 7.9 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7.9 7.9 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.9 7.9 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.9 7.9 0 0 0 1.7-1l2.3 1 2-3.4z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
