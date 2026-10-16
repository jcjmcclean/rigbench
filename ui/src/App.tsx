import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { SignalChain } from "./components/SignalChain";
import { Toasts, type ToastItem } from "./components/Toast";
import { bridge, isMock } from "./bridge";
import type { EngineState } from "./types";
import "./App.css";

// A fingerprint of the live rig (slots + trims) so we can tell when it has
// diverged from the loaded/saved preset snapshot.
function rigSignature(s: EngineState): string {
  const slots = Object.values(s.slots).map(
    (sl) => `${sl.type}:${sl.loaded}:${sl.name}:${sl.bypassed}:${sl.mix ?? ""}:${sl.gain ?? ""}`,
  );
  return `${s.inputGain}|${s.masterGain}|${slots.join("|")}`;
}

export default function App() {
  const [state, setState] = useState<EngineState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  useEffect(() => bridge.subscribe(setState), []);

  // Track presence of engine state in a ref so the error handler can branch on it
  // without reading state through a setState updater (an updater must stay pure —
  // doing side effects there double-fires them under StrictMode → duplicate toasts).
  const hasStateRef = useRef(false);
  useEffect(() => { hasStateRef.current = state !== null; }, [state]);

  const MAX_TOASTS = 4;
  useEffect(() => {
    return bridge.subscribeError((message) => {
      // No engine state yet → fatal "couldn't connect"; otherwise a recoverable
      // notice (e.g. a model failed to load) shown as a toast (newest kept, capped).
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
  // save), then compare the live signature against it.
  const [dirty, setDirty] = useState(false);
  const snapRef = useRef<string>("");
  const prevPreset = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!state) return;
    const sig = rigSignature(state);
    if (state.activePreset !== prevPreset.current) {
      prevPreset.current = state.activePreset;
      snapRef.current = sig;
    }
    setDirty(sig !== snapRef.current);
  }, [state]);

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
      <TopBar state={state} dirty={dirty} />

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
    </div>
  );
}
