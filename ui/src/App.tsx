import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { SignalChain } from "./components/SignalChain";
import { bridge, isMock } from "./bridge";
import type { EngineState } from "./types";
import "./App.css";

function useEngine(): EngineState | null {
  const [state, setState] = useState<EngineState | null>(null);
  useEffect(() => bridge.subscribe(setState), []);
  return state;
}

export default function App() {
  const state = useEngine();
  if (!state) return null;

  return (
    <div className="app">
      <TopBar state={state} />

      <main className="stage">
        <SignalChain state={state} />
      </main>

      <footer className="statusbar">
        <span className="statusbar__hint mono">
          Drag knobs · ↑↓ to adjust · click a slot to load
        </span>
        <span className="statusbar__right">
          {isMock && <span className="badge badge--mock">Preview — mock engine</span>}
          <span className="statusbar__ver mono">v0.1</span>
        </span>
      </footer>
    </div>
  );
}
