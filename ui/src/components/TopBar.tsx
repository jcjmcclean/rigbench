import { PresetMenu } from "./PresetMenu";
import { bridge } from "../bridge";
import { rateLabel } from "../audioSetup";
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

export function TopBar({
  state,
  dirty,
  onPresetSaved,
  onPresetRenamed,
  onOpenSettings,
  onOpenTuner,
}: {
  state: EngineState;
  dirty: boolean;
  onPresetSaved?: (name: string) => void;
  onPresetRenamed?: (name: string) => void;
  onOpenSettings?: () => void;
  onOpenTuner?: () => void;
}) {
  const latTone = state.roundTripMs < 12 ? "good" : state.roundTripMs < 20 ? "warn" : "bad";
  // Pair the colour with a word so the status isn't colour-only.
  const latWord = latTone === "good" ? "low" : latTone === "warn" ? "medium" : "high";
  const running = state.sampleRate > 0;

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark" aria-hidden />
        <span className="topbar__word">Tone<em>bench</em></span>
      </div>

      <div className="topbar__telemetry">
        <Telem label="Device" value={running ? state.device : "No audio device"} tone={running ? undefined : "bad"} />
        <span className="topbar__sep" />
        <Telem label="Rate" value={running ? rateLabel(state.sampleRate) : "—"} />
        <Telem label="Buffer" value={running ? `${state.bufferSize}` : "—"} />
        <Telem
          label="Latency"
          value={running ? `${state.roundTripMs.toFixed(1)} ms · ${latWord}` : "—"}
          tone={running ? latTone : undefined}
        />
      </div>

      <div className="topbar__actions">
        <PresetMenu presets={state.presets} active={state.activePreset} dirty={dirty} onSaved={onPresetSaved} onRenamed={onPresetRenamed} />
        <button className="iconbtn" onClick={onOpenTuner} title="Tuner" aria-label="Tuner">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M9 2v8a3 3 0 0 0 6 0V2" />
            <path d="M12 13v9" />
          </svg>
        </button>
        {/* A toggle with a fixed name, pressed while you can hear your guitar.
            The visible Live/Muted is the state. */}
        <button
          className={`transport ${state.monitoring ? "is-live" : ""}`}
          aria-label="Hear your guitar"
          aria-pressed={state.monitoring}
          onClick={() => bridge.setMonitor(!state.monitoring)}
          title={state.monitoring ? "Live: click to mute" : "Muted: click to hear your guitar"}
        >
          <span className={`transport__dot jewel${state.monitoring ? " jewel--lit" : ""}`} aria-hidden />
          {state.monitoring ? "Live" : "Muted"}
        </button>
        <button className="iconbtn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.9 7.9 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7.9 7.9 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.9 7.9 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.9 7.9 0 0 0 1.7-1l2.3 1 2-3.4z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
