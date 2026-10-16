import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { SignalChain } from "./components/SignalChain";
import { Toasts, type ToastItem } from "./components/Toast";
import { Settings } from "./components/Settings";
import { Setup } from "./components/Setup";
import { Tuner } from "./components/Tuner";
import { bridge, isMock } from "./bridge";
import type { EngineState } from "./types";
import "./App.css";

// A fingerprint of the live rig (slots + trims) so we can tell when it has
// diverged from the loaded/saved preset snapshot.
function rigSignature(s: EngineState): string {
  const slots = Object.values(s.slots).map(
    (sl) => `${sl.type}:${sl.loaded}:${sl.name}:${sl.bypassed}:${sl.mix ?? ""}:${sl.gain ?? ""}`,
  );
  return `${s.inputGain}|${s.masterGain}|${s.gate}|${slots.join("|")}`;
}

// How long to wait for the engine's first state before saying it can't be
// reached (JUCE never rejects a native call, so a broken bridge would otherwise
// leave "Connecting…" up for ever).
export const CONNECT_TIMEOUT_MS = 8000;

export default function App() {
  const [state, setState] = useState<EngineState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  useEffect(() => bridge.subscribe(setState), []);

  // Settings screen, and first-run setup (shown until the engine says it's done,
  // or again when asked for from Settings).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [setupAgain, setSetupAgain] = useState(false);
  const showSetup = !!state && (!state.setupComplete || setupAgain);
  useEffect(() => bridge.subscribeShowSettings(() => setSettingsOpen(true)), []);


  useEffect(() => {
    if (state) return;
    const t = setTimeout(
      () => setFatal("Tonebench’s window opened, but it couldn’t talk to the audio engine. Try restarting the app."),
      CONNECT_TIMEOUT_MS,
    );
    return () => clearTimeout(t);
  }, [state]);

  // Track presence of engine state in a ref so the error handler can branch on it
  // without reading state through a setState updater (an updater must stay pure —
  // doing side effects there double-fires them under StrictMode → duplicate toasts).
  const hasStateRef = useRef(false);
  useEffect(() => { hasStateRef.current = state !== null; }, [state]);

  // Name of a preset save the user just requested (see dirty tracking below).
  const pendingSave = useRef<string | null>(null);

  const MAX_TOASTS = 4;
  useEffect(() => {
    return bridge.subscribeError((message) => {
      // No engine state yet → fatal "couldn't connect"; otherwise a recoverable
      // notice (e.g. a model failed to load) shown as a toast (newest kept, capped).
      // A save that errors must not re-baseline the "edited" tracking below.
      pendingSave.current = null;
      if (!hasStateRef.current) {
        setFatal(message);
      } else {
        const id = ++toastId.current;
        setToasts((t) => [...t, { id, message }].slice(-MAX_TOASTS));
      }
    });
  }, []);

  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );

  // Dirty tracking: snapshot the rig whenever the active preset changes (load or
  // save), then compare the live signature against it. Saving over the active
  // preset keeps the same name, so a requested save is remembered and the
  // snapshot retaken once the engine reports that preset as active.
  const [dirty, setDirty] = useState(false);
  const snapRef = useRef<string>("");
  const prevPreset = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!state) return;
    const sig = rigSignature(state);
    const saved = pendingSave.current !== null && pendingSave.current === state.activePreset;
    if (state.activePreset !== prevPreset.current || saved) {
      prevPreset.current = state.activePreset;
      pendingSave.current = null;
      snapRef.current = sig;
    }
    setDirty(sig !== snapRef.current);
  }, [state]);
  const onPresetSaved = useCallback((name: string) => { pendingSave.current = name; }, []);

  if (fatal && !state) {
    return (
      <div className="splash splash--error">
        <span className="splash__mark" aria-hidden />
        <h1 className="splash__title">Can’t reach the audio engine</h1>
        <p className="splash__msg">{fatal}</p>
        <button className="btn btn--primary" onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="splash" role="status" aria-live="polite">
        <span className="splash__mark splash__mark--pulse" aria-hidden />
        <span className="splash__word">Tone<em>bench</em></span>
        <span className="splash__hint mono">Connecting to engine…</span>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar state={state} dirty={dirty} onPresetSaved={onPresetSaved} onOpenSettings={() => setSettingsOpen(true)} onOpenTuner={() => setTunerOpen(true)} />

      <main className="stage">
        <SignalChain state={state} />
      </main>

      <footer className="statusbar">
        <span className="statusbar__hint mono">
          Drag knobs · ↑↓ ←→ or scroll to adjust · Shift for fine · click a slot to load
        </span>
        <span className="statusbar__right">
          {isMock && <span className="badge badge--mock">Preview — mock engine</span>}
          <span className="statusbar__ver mono">v0.1</span>
        </span>
      </footer>

      <Toasts items={toasts} onDismiss={dismissToast} />

      {settingsOpen && !showSetup && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          onRunSetup={() => { setSettingsOpen(false); setSetupAgain(true); }}
        />
      )}
      {tunerOpen && !showSetup && !settingsOpen && <Tuner onClose={() => setTunerOpen(false)} />}
      {showSetup && <Setup onDone={() => setSetupAgain(false)} />}
    </div>
  );
}
