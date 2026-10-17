import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { SignalChain } from "./components/SignalChain";
import { Toasts, type ToastItem } from "./components/Toast";
import { Settings } from "./components/Settings";
import { Setup } from "./components/Setup";
import { Tuner } from "./components/Tuner";
import { PluginPicker } from "./components/PluginPicker";
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

export const VERSION = "0.1.0"; // x-release-please-version

// What the status bar says about the knobs. The website demo turns the scroll
// wheel off (it scrolls the page there), so it leaves the wheel out.
function knobHint(wheel: boolean): string {
  return wheel
    ? "Drag a knob, or use the arrow keys or scroll wheel. Hold Shift for finer control."
    : "Drag a knob, or use the arrow keys. Hold Shift for finer control.";
}

// wheel: whether the scroll wheel turns knobs (false in the website showcase).
export default function App({ wheel = true }: { wheel?: boolean } = {}) {
  const [state, setState] = useState<EngineState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  useEffect(() => bridge.subscribe(setState), []);

  // The dialog App owns (Settings, the tuner, the plugin picker), and first-run
  // setup (shown until the engine says it's done, or again when asked for from
  // Settings).
  //
  // One dialog at a time: a request to open one while any dialog is on screen
  // is ignored. That covers the ones App doesn't own too (the preset menu's
  // save/rename/delete, and setup), so the app menu's Settings… can't stack a
  // second dialog over them.
  const [dialog, setDialog] = useState<"settings" | "tuner" | "picker" | null>(null);
  const openDialog = useCallback((d: "settings" | "tuner" | "picker") => {
    if (document.querySelector('[role="dialog"]')) return;
    setDialog(d);
  }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const [setupAgain, setSetupAgain] = useState(false);
  const showSetup = !!state && (!state.setupComplete || setupAgain);
  useEffect(() => bridge.subscribeShowSettings(() => openDialog("settings")), [openDialog]);

  useEffect(() => {
    if (state) return;
    const t = setTimeout(
      () => setFatal("The window opened, but the audio engine didn’t answer. Click Retry. If that doesn’t help, quit Rigbench and open it again."),
      CONNECT_TIMEOUT_MS,
    );
    return () => clearTimeout(t);
  }, [state]);

  // Track presence of engine state in a ref so the error handler can branch on it
  // without reading state through a setState updater (an updater must stay pure —
  // doing side effects there double-fires them under StrictMode → duplicate toasts).
  const hasStateRef = useRef(false);
  useEffect(() => { hasStateRef.current = state !== null; }, [state]);

  // Name of a preset save or rename the user just requested (see dirty tracking below).
  const pendingSave = useRef<string | null>(null);
  const pendingRename = useRef<string | null>(null);

  const MAX_TOASTS = 4;
  useEffect(() => {
    return bridge.subscribeError((message) => {
      // No engine state yet → fatal "couldn't connect"; otherwise a recoverable
      // notice (e.g. a model failed to load) shown as a toast (newest kept, capped).
      // A save or rename that errors must not re-baseline the "edited" tracking below.
      pendingSave.current = null;
      pendingRename.current = null;
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
  // snapshot retaken once the engine reports that preset as active. A rename
  // changes the name without saving, so it keeps the snapshot (and "edited").
  const [dirty, setDirty] = useState(false);
  const snapRef = useRef<string>("");
  const prevPreset = useRef<string | null | undefined>(undefined);
  const wasLoadingPreset = useRef(false);
  useEffect(() => {
    if (!state) return;
    const sig = rigSignature(state);
    // A preset's plugin arrives after the rest of it (consent prompt, then an
    // async load). Until it has, and in the state where it lands, the rig is
    // still the preset loading, not an edit.
    const loading = state.loadingPreset || wasLoadingPreset.current;
    wasLoadingPreset.current = state.loadingPreset;
    const saved = pendingSave.current !== null && pendingSave.current === state.activePreset;
    if (state.activePreset !== prevPreset.current || saved) {
      const renamed = !saved && pendingRename.current !== null && pendingRename.current === state.activePreset;
      prevPreset.current = state.activePreset;
      pendingSave.current = null;
      pendingRename.current = null;
      if (!renamed) snapRef.current = sig;
    }
    if (loading) snapRef.current = sig;
    setDirty(sig !== snapRef.current);
  }, [state]);
  const onPresetSaved = useCallback((name: string) => { pendingSave.current = name; }, []);
  const onPresetRenamed = useCallback((name: string) => { pendingRename.current = name; }, []);

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
        <span className="splash__word">Rig<em>bench</em></span>
        <span className="splash__hint mono">Connecting to the audio engine…</span>
      </div>
    );
  }

  // While setup is up, the app behind it can't be clicked or tabbed into.
  const behindSetup = showSetup ? true : undefined;

  return (
    <div className="app">
      <TopBar
        inert={behindSetup}
        state={state}
        dirty={dirty}
        onPresetSaved={onPresetSaved}
        onPresetRenamed={onPresetRenamed}
        onOpenSettings={() => openDialog("settings")}
        onOpenTuner={() => openDialog("tuner")}
      />

      <main className="stage" inert={behindSetup}>
        <SignalChain state={state} onPickPlugin={() => openDialog("picker")} />
      </main>

      <footer className="statusbar" inert={behindSetup}>
        <span className="statusbar__hint mono">
          {knobHint(wheel)}
        </span>
        <span className="statusbar__right">
          {isMock && <span className="badge badge--mock">Preview: no sound</span>}
          <span className="statusbar__ver mono">v{VERSION}</span>
        </span>
      </footer>

      <Toasts items={toasts} onDismiss={dismissToast} />

      {dialog === "settings" && !showSetup && (
        <Settings
          onClose={closeDialog}
          onRunSetup={() => { setDialog(null); setSetupAgain(true); }}
        />
      )}
      {dialog === "tuner" && !showSetup && <Tuner onClose={closeDialog} />}
      {dialog === "picker" && !showSetup && <PluginPicker onClose={closeDialog} />}
      {showSetup && <Setup monitoring={state.monitoring} onDone={() => setSetupAgain(false)} />}
    </div>
  );
}
