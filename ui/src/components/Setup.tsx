import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import type { AudioSetup, AudioSetupChanges } from "../types";
import { findGuitar, levelAdvice } from "../audioSetup";
import "./Setup.css";

type Step = "device" | "input" | "output";
const steps: Step[] = ["device", "input", "output"];

// First-run setup: pick the interface, find the input the guitar is on, pick
// where to hear it. Monitoring stays off until it's finished (or skipped).
export function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("device");
  const [setup, setSetup] = useState<AudioSetup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Input step: each input's recent loudest level (slowly decaying), and the
  // input the player picked by hand, if they did. Otherwise we pick the loudest.
  const [held, setHeld] = useState<number[]>([]);
  const [handPick, setHandPick] = useState<number | null>(null);
  const chosen = handPick ?? findGuitar(held);

  useEffect(() => {
    let live = true;
    bridge.getAudioSetup().then((s) => { if (live) setSetup(s); });
    return () => { live = false; };
  }, []);

  useEffect(() => { headingRef.current?.focus(); }, [step]);

  const apply = async (changes: AudioSetupChanges) => {
    setBusy(true);
    const next = await bridge.setAudioSetup(changes);
    setSetup(next);
    setError(next.error);
    setBusy(false);
    return next;
  };

  // Listen to every input while finding the guitar.
  useEffect(() => {
    if (step !== "input") return;
    return bridge.subscribeInputPeaks((peaks) =>
      setHeld((prev) => peaks.map((p, i) => Math.max(p, (prev[i] ?? 0) * 0.99))));
  }, [step]);

  const finish = () => { bridge.finishSetup(); onDone(); };

  const goTo = async (next: Step) => {
    if (next === "input") {
      setHeld([]);
      setHandPick(null);
      await apply({ listenToAllInputs: true });
    }
    if (step === "input" && next === "output" && chosen !== null) await apply({ input: chosen });
    setStep(next);
  };

  if (!setup) {
    return (
      <div className="setup" role="dialog" aria-modal="true" aria-label="Setup">
        <div className="setup__card"><p className="setup__lead">Looking for audio devices…</p></div>
      </div>
    );
  }

  const index = steps.indexOf(step);
  const inputs = setup.inputs;
  const loudest = chosen !== null ? held[chosen] ?? 0 : 0;

  return (
    <div className="setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className="setup__card">
        <div className="setup__progress" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((s, i) => <span key={s} className={`setup__dot${i <= index ? " is-on" : ""}`} />)}
        </div>

        {step === "device" && (
          <>
            <h1 id="setup-title" className="setup__title" tabIndex={-1} ref={headingRef}>What’s your guitar plugged into?</h1>
            <p className="setup__lead">Pick your audio interface. You can change this later in Settings.</p>
            <Choices
              label="Audio interface"
              options={setup.inputDevices}
              value={setup.inputDevice}
              onChange={(d) => apply({ inputDevice: d, ...(setup.outputDevices.includes(d) ? { outputDevice: d } : {}) })}
            />
            {setup.inputDevices.length === 0 && (
              <p className="setup__note">No audio inputs found. Plug in your interface, then choose Look again.</p>
            )}
            {setup.builtInInput && (
              <p className="setup__note setup__note--warn">
                That’s your computer’s own microphone. Use headphones with it: through speakers it will feed back.
              </p>
            )}
            {setup.drivers.length > 1 && (
              <label className="setup__driver">
                Driver
                <select className="field" value={setup.driver} onChange={(e) => apply({ driver: e.target.value })}>
                  {setup.drivers.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
            )}
          </>
        )}

        {step === "input" && (
          <>
            <h1 id="setup-title" className="setup__title" tabIndex={-1} ref={headingRef}>Play a few notes</h1>
            <p className="setup__lead">
              {chosen !== null
                ? `Found your guitar on ${inputs[chosen]}.`
                : "Strum or pick a few notes and Tonebench will find which input your guitar is on."}
            </p>
            <div className="inputs" role="radiogroup" aria-label="Input">
              {inputs.slice(0, 16).map((name, i) => (
                <button
                  key={name + i}
                  role="radio"
                  aria-checked={chosen === i}
                  className={`inputs__row${chosen === i ? " is-chosen" : ""}`}
                  onClick={() => setHandPick(i)}
                >
                  <span className="inputs__name">{name}</span>
                  <span className="inputs__bar" aria-hidden>
                    <span className="inputs__fill" style={{ width: `${Math.min(100, Math.sqrt(held[i] ?? 0) * 100)}%` }} />
                  </span>
                </button>
              ))}
            </div>
            {chosen !== null && loudest > 0 && <p className="setup__note">{levelAdvice(loudest)}</p>}
            {inputs.length === 0 && <p className="setup__note">This device has no inputs. Go back and pick another.</p>}
          </>
        )}

        {step === "output" && (
          <>
            <h1 id="setup-title" className="setup__title" tabIndex={-1} ref={headingRef}>Where do you want to hear it?</h1>
            <p className="setup__lead">Pick headphones or speakers, then play the test sound.</p>
            <Choices
              label="Output"
              options={setup.outputDevices}
              value={setup.outputDevice}
              onChange={(d) => apply({ outputDevice: d })}
            />
            <button className="btn setup__test" onClick={() => bridge.playTestSound()}>Play test sound</button>
            <p className="setup__note">
              If you hear your clean guitar as well as Tonebench, turn off direct monitoring on your interface.
            </p>
          </>
        )}

        {error && <p className="setup__note setup__note--warn" role="alert">{error}</p>}

        <div className="setup__actions">
          <button className="setup__skip" onClick={finish}>Skip setup</button>
          <span className="setup__spacer" />
          {index > 0 && <button className="btn" onClick={() => setStep(steps[index - 1])} disabled={busy}>Back</button>}
          {step === "device" && setup.inputDevices.length === 0 && (
            <button className="btn" onClick={() => bridge.getAudioSetup().then(setSetup)}>Look again</button>
          )}
          {step !== "output" ? (
            <button
              className="btn btn--primary"
              onClick={() => goTo(steps[index + 1])}
              disabled={busy || (step === "device" && !setup.inputDevice) || (step === "input" && chosen === null)}
            >
              Next
            </button>
          ) : (
            <button className="btn btn--primary" onClick={finish} disabled={busy}>Start playing</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Choices({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={o === value} className={`choices__item${o === value ? " is-chosen" : ""}`} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
