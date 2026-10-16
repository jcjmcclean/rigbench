import { Fragment } from "react";
import { ChainModule } from "./ChainModule";
import { Meter } from "./Meter";
import { Knob } from "./Knob";
import { bridge } from "../bridge";
import type { EngineState, SlotType } from "../types";
import "./SignalChain.css";

const ORDER: SlotType[] = ["vst3", "nam", "ir"];

function Connector({ active }: { active: boolean }) {
  return (
    <div className={`connector ${active ? "is-live" : ""}`} aria-hidden>
      <span className="connector__line" />
      <span className="connector__pulse" />
    </div>
  );
}

function Terminal({
  kind,
  level,
  state,
}: {
  kind: "in" | "out";
  level: number;
  state: EngineState;
}) {
  return (
    <div className={`terminal terminal--${kind}`}>
      <div className="terminal__jack" aria-hidden>
        <span className="terminal__ring" />
        <span className="terminal__tip" />
      </div>
      <span className="terminal__label eyebrow">{kind === "in" ? "Input" : "Output"}</span>
      {kind === "in" && (
        <Knob
          value={state.inputGain}
          onChange={(v) => bridge.setInput(v)}
          label="Gain"
          size={52}
          format={(v) => `${Math.round(v * 100)}`}
        />
      )}
      {kind === "out" && (
        <Knob
          value={state.masterGain}
          onChange={(v) => bridge.setMaster(v)}
          label="Master"
          size={52}
          format={(v) => `${Math.round(v * 100)}`}
        />
      )}
      <Meter value={level} orientation="v" label={kind === "in" ? "IN" : "OUT"} />
    </div>
  );
}

export function SignalChain({ state }: { state: EngineState }) {
  const flow = state.playing ? Math.max(0.14, state.outputLevel) : 0;
  const anyActive = ORDER.some((t) => state.slots[t].loaded && !state.slots[t].bypassed);

  return (
    <div className="chain" style={{ ["--flow" as string]: flow }}>
      <Terminal kind="in" level={state.inputLevel} state={state} />
      <Connector active={state.playing && state.inputLevel > 0.02} />

      {ORDER.map((type, i) => (
        <Fragment key={type}>
          <ChainModule
            slot={state.slots[type]}
            index={i}
            onLoad={() => bridge.loadSlot(type)}
            onClear={() => bridge.clearSlot(type)}
            onBypass={(b) => bridge.setBypass(type, b)}
            onMix={(v) => bridge.setMix(type, v)}
            onGain={(v) => bridge.setGain(type, v)}
            onEditor={() => bridge.openEditor()}
          />
          <Connector active={state.playing && anyActive && state.outputLevel > 0.02} />
        </Fragment>
      ))}

      <Terminal kind="out" level={state.outputLevel} state={state} />
    </div>
  );
}
