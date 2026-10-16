import { Fragment } from "react";
import { ChainModule } from "./ChainModule";
import { Meter } from "./Meter";
import { Knob } from "./Knob";
import { ScopeWaveform } from "./ScopeWaveform";
import { bridge } from "../bridge";
import type { EngineState, SlotType } from "../types";
import { gateLabel, pct01 } from "../format";
import "./SignalChain.css";

const ORDER: SlotType[] = ["vst3", "nam", "ir"];

// The signal path between units. On desktop the ScopeWaveform canvas is the
// visible cable (threaded behind the rack), so these line/pulse spans are hidden
// by CSS; on mobile the scope is gone, so they become the visible cable.
function Connector({ live }: { live: boolean }) {
  return (
    <div className={`connector${live ? " is-live" : ""}`} aria-hidden>
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
        <>
          <Knob
            value={state.inputGain}
            onChange={(v) => bridge.setInput(v)}
            label="Gain"
            size={52}
            format={pct01}
          />
          <Knob
            value={state.gate}
            onChange={(v) => bridge.setGate(v)}
            label="Gate"
            size={40}
            format={gateLabel}
          />
        </>
      )}
      {kind === "out" && (
        <Knob
          value={state.masterGain}
          onChange={(v) => bridge.setMaster(v)}
          label="Master"
          size={52}
          format={pct01}
        />
      )}
      <Meter value={level} orientation="v" label={kind === "in" ? "IN" : "OUT"} />
    </div>
  );
}

export function SignalChain({ state }: { state: EngineState }) {
  // No idle floor: when there's no signal, nothing flows.
  const flow = state.playing ? state.outputLevel : 0;
  const live = state.playing;

  return (
    <div className="chain" style={{ ["--flow" as string]: flow }}>
      <ScopeWaveform />

      <Terminal kind="in" level={state.inputLevel} state={state} />
      <Connector live={live} />

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
            onOpenUrl={(url) => bridge.openUrl(url)}
          />
          <Connector live={live} />
        </Fragment>
      ))}

      <Terminal kind="out" level={state.outputLevel} state={state} />
    </div>
  );
}
