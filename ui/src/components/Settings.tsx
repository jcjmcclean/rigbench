import { useEffect, useId, useState } from "react";
import { bridge } from "../bridge";
import type { AudioSetup, AudioSetupChanges } from "../types";
import { bufferLabel, rateLabel } from "../audioSetup";
import { Modal } from "./Modal";
import "./Settings.css";

// Audio settings in plain words, with the numbers alongside. The everyday
// choices are up top; driver and sample rate sit under Advanced.
export function Settings({ onClose, onRunSetup }: { onClose: () => void; onRunSetup: () => void }) {
  const [setup, setSetup] = useState<AudioSetup | null>(null);
  const [inputLevel, setInputLevel] = useState(0);   // live level of the guitar's input

  useEffect(() => bridge.subscribeInputPeaks((p) => setInputLevel(p[0] ?? 0)), []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    bridge.getAudioSetup().then((s) => { if (live) { setSetup(s); setError(s.error); } });
    return () => { live = false; };
  }, []);

  const apply = async (changes: AudioSetupChanges) => {
    setBusy(true);
    const next = await bridge.setAudioSetup(changes);
    setSetup(next);
    setError(next.error);
    setBusy(false);
  };

  return (
    <Modal title="Settings" onClose={onClose} wide>
      {!setup ? (
        <p className="settings__status">Looking for audio devices…</p>
      ) : (
        <div className="settings" aria-busy={busy}>
          <p className={`settings__status${setup.sampleRate > 0 ? " is-ok" : ""}`} role="status">
            {setup.sampleRate > 0
              ? `Running at ${rateLabel(setup.sampleRate)} · about ${Math.round(setup.latencyMs)} ms latency`
              : "No audio device is running. Pick one below."}
          </p>

          <Row label="Audio interface">
            {(id) => (
              <Select id={id} value={setup.inputDevice} options={setup.inputDevices} onChange={(v) => apply({ inputDevice: v })} />
            )}
          </Row>

          <Row label="Guitar input">
            {(id) => (
              <div className="settings__with-meter">
                <Select
                  id={id}
                  value={setup.input >= 0 ? String(setup.input) : ""}
                  options={setup.inputs.map((_, i) => String(i))}
                  labels={setup.inputs}
                  placeholder="Choose an input"
                  onChange={(v) => apply({ input: Number(v) })}
                />
                <span className="settings__meter" aria-hidden>
                  <span style={{ width: `${Math.min(100, Math.sqrt(inputLevel) * 100)}%` }} />
                </span>
              </div>
            )}
          </Row>
          {setup.builtInInput && (
            <p className="settings__warn">That’s your computer’s built-in microphone. Use headphones with it, or it will feed back through the speakers.</p>
          )}

          <Row label="Output">
            {(id) => (
              <div className="settings__with-button">
                <Select id={id} value={setup.outputDevice} options={setup.outputDevices} onChange={(v) => apply({ outputDevice: v })} />
                <button className="btn" onClick={() => bridge.playTestSound()}>Play test sound</button>
              </div>
            )}
          </Row>

          <Row label="Buffer size" hint="Smaller feels more immediate. If you hear crackles or dropouts, pick a bigger one.">
            {(id) => (
              <Select
                id={id}
                value={String(setup.bufferSize)}
                options={setup.bufferSizes.map(String)}
                labels={setup.bufferSizes.map((b) => bufferLabel(b, setup.sampleRate))}
                onChange={(v) => apply({ bufferSize: Number(v) })}
              />
            )}
          </Row>

          <details className="settings__advanced">
            <summary>Advanced</summary>
            {setup.drivers.length > 1 && (
              <Row label="Driver">
                {(id) => <Select id={id} value={setup.driver} options={setup.drivers} onChange={(v) => apply({ driver: v })} />}
              </Row>
            )}
            <Row label="Sample rate">
              {(id) => (
                <Select
                  id={id}
                  value={String(setup.sampleRate)}
                  options={setup.sampleRates.map(String)}
                  labels={setup.sampleRates.map(rateLabel)}
                  onChange={(v) => apply({ sampleRate: Number(v) })}
                />
              )}
            </Row>
          </details>

          {error && <p className="settings__warn" role="alert">{error}</p>}
        </div>
      )}

      <div className="modal__actions">
        <button className="btn settings__setup" onClick={onRunSetup}>Run setup again</button>
        <button className="btn btn--primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="settings__row">
      <label className="settings__label" htmlFor={id}>{label}</label>
      <div className="settings__control">
        {children(id)}
        {hint && <span className="settings__hint">{hint}</span>}
      </div>
    </div>
  );
}

function Select({
  id,
  value,
  options,
  labels,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  labels?: string[];
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const missing = value === "" || !options.includes(value);
  return (
    <select id={id} className="field settings__select" value={missing ? "" : value} onChange={(e) => onChange(e.target.value)}>
      {missing && <option value="" disabled>{placeholder ?? "None"}</option>}
      {options.map((o, i) => <option key={o} value={o}>{labels?.[i] ?? o}</option>)}
    </select>
  );
}
