import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import type { TunerReading } from "../types";
import { Modal } from "./Modal";
import "./Tuner.css";

// Within this many cents counts as in tune.
const IN_TUNE_CENTS = 3;

const isInTune = (r: TunerReading | null) => r !== null && Math.abs(r.cents) <= IN_TUNE_CENTS;

// The tuner: turns the engine's tuner on while open (which mutes the output),
// shows the nearest note and how far off it is.
//
// Readings arrive about 30 times a second, so the note, needle and advice on
// screen aren't live regions. A screen reader hears one hidden line instead,
// which changes only when the note changes ("E 2") or that note first gets in
// tune ("In tune").
export function Tuner({ onClose }: { onClose: () => void }) {
  const [reading, setReading] = useState<TunerReading | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const heard = useRef<{ note: string | null; tuned: boolean }>({ note: null, tuned: false });

  useEffect(() => {
    bridge.setTuner(true);
    const off = bridge.subscribeTuner((r) => {
      setReading(r);
      if (!r) return;   // silence between notes says nothing
      const note = `${r.note} ${r.octave}`;
      const tuned = isInTune(r);
      const last = heard.current;
      if (note !== last.note) {
        heard.current = { note, tuned };
        setAnnouncement(tuned ? `${note}, in tune` : note);
      } else if (tuned && !last.tuned) {
        heard.current = { note, tuned: true };
        setAnnouncement("In tune");
      }
    });
    return () => { off(); bridge.setTuner(false); };
  }, []);

  const inTune = isInTune(reading);
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
        <div className="tuner__note">
          {reading ? reading.note : "–"}
          {reading && <span className="tuner__octave">{reading.octave}</span>}
        </div>

        <div className="tuner__scale" aria-hidden>
          <span className="tuner__centre" />
          <span className="tuner__needle" style={{ left: `${50 + offset}%` }} />
        </div>
        <div className="tuner__marks" aria-hidden><span>♭</span><span>♯</span></div>

        <p className="tuner__advice">{advice}</p>
        <p className="visually-hidden" role="status">{announcement}</p>
        <p className="tuner__muted">Your output is muted while the tuner is open.</p>
      </div>
      <div className="modal__actions">
        <button className="btn btn--primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
