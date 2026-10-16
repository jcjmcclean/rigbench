import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import type { TunerReading } from "../types";
import { Modal } from "./Modal";
import "./Tuner.css";

// Within this many cents counts as in tune.
const IN_TUNE_CENTS = 3;

// The tuner: turns the engine's tuner on while open (which mutes the output),
// shows the nearest note and how far off it is.
export function Tuner({ onClose }: { onClose: () => void }) {
  const [reading, setReading] = useState<TunerReading | null>(null);

  useEffect(() => {
    bridge.setTuner(true);
    const off = bridge.subscribeTuner(setReading);
    return () => { off(); bridge.setTuner(false); };
  }, []);

  const inTune = reading !== null && Math.abs(reading.cents) <= IN_TUNE_CENTS;
  const offset = reading ? Math.max(-50, Math.min(50, reading.cents)) : 0;
  const advice = !reading
    ? "Play a single string."
    : inTune
      ? "In tune."
      : reading.cents < 0
        ? `${Math.abs(Math.round(reading.cents))} cents flat: tune up.`
        : `${Math.round(reading.cents)} cents sharp: tune down.`;

  return (
    <Modal title="Tuner" onClose={onClose}>
      <div className={`tuner${inTune ? " is-in-tune" : ""}${reading ? "" : " is-idle"}`}>
        <div className="tuner__note" aria-live="polite">
          {reading ? reading.note : "–"}
          {reading && <span className="tuner__octave">{reading.octave}</span>}
        </div>

        <div className="tuner__scale" aria-hidden>
          <span className="tuner__centre" />
          <span className="tuner__needle" style={{ left: `${50 + offset}%` }} />
        </div>
        <div className="tuner__marks" aria-hidden><span>♭</span><span>♯</span></div>

        <p className="tuner__advice" role="status">{advice}</p>
        <p className="tuner__muted">Your output is muted while the tuner is open.</p>
      </div>
      <div className="modal__actions">
        <button className="btn btn--primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
