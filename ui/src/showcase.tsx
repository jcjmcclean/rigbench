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
import { bridge } from "./bridge";

// Show a full rig: the mock starts with the VST3 slot empty.
bridge.loadSlot("vst3");

// On a webpage the wheel should scroll the page, not turn whatever knob happens
// to be under the cursor. Stopping it at the window (capture phase) keeps it from
// reaching the knob's listener, and the unhandled scroll chains to the parent page.
// <App wheel={false}> below keeps the status-bar hint from mentioning the wheel.
window.addEventListener("wheel", (e) => e.stopPropagation(), { capture: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App wheel={false} />
  </StrictMode>,
);
