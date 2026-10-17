// Website showcase entry: the real app UI driven by the mock engine, embedded
// in site/index.html as interactive previews. Built with `npm run build:showcase`
// into site/app/ — never part of the embedded webui.zip.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans-condensed/latin-500.css";
import "@fontsource/ibm-plex-sans-condensed/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";

import "./styles/tokens.css";
import "./styles/global.css";
import "./showcase.css";
import App from "./App.tsx";
import { bridge, setMockTunerInput } from "./bridge";
import { startMicTuner } from "./micTuner";

// Show a full rig: the mock starts with the VST3 slot empty.
bridge.loadSlot("vst3");

// On a webpage the wheel should scroll the page, not turn whatever knob happens
// to be under the cursor. Stopping it at the window (capture phase) keeps it from
// reaching the knob's listener, and the unhandled scroll chains to the parent page.
// <App wheel={false}> below keeps the status-bar hint from mentioning the wheel.
window.addEventListener("wheel", (e) => e.stopPropagation(), { capture: true });

// ?view=tuner: the site crops this embed to the tuner, so keep it open (Done or
// Escape just opens it again), and let the page switch the microphone on and off.
if (new URLSearchParams(location.search).get("view") === "tuner") {
  const keepOpen = () => {
    if (document.querySelector(".tuner")) return;
    document.querySelector<HTMLButtonElement>('button[aria-label="Tuner"]')?.click();
  };
  new MutationObserver(keepOpen).observe(document.getElementById("root")!, { childList: true, subtree: true });

  // One microphone at most: a second start while the browser is still asking
  // waits on the first, and a stop while it's asking lets go as soon as it can.
  let stop: (() => void) | null = null;
  let starting: Promise<void> | null = null;
  let wanted = false;
  window.rigbenchMic = {
    start() {
      wanted = true;
      if (stop) return Promise.resolve();
      starting ??= startMicTuner(setMockTunerInput)
        .then((s) => {
          if (wanted) stop = s;
          else s();
        })
        .finally(() => { starting = null; });
      return starting;
    },
    stop() {
      wanted = false;
      stop?.();
      stop = null;
      setMockTunerInput(undefined);
    },
  };
}

declare global {
  interface Window {
    rigbenchMic?: { start(): Promise<void>; stop(): void };
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App wheel={false} />
  </StrictMode>,
);
