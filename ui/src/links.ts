import type { SlotType } from "./types";

// Where to get something for each slot. Shown on empty slots and in setup.
// Checked 2026-10-16: these are the canonical sites (watch out for look-alike
// "hub" repos when updating; see notes in docs/ROADMAP.md).
export interface SoundLink {
  label: string;
  url: string;
}

export const soundLinks: Record<SlotType, SoundLink[]> = {
  nam: [
    { label: "Free amp models on TONE3000", url: "https://www.tone3000.com/search?format=nam" },
  ],
  ir: [
    { label: "Free cab IRs on TONE3000", url: "https://www.tone3000.com/search?format=ir" },
    { label: "Jester Dyne’s Emerald pack (no sign-up)", url: "https://www.jester-dyne-productions.com/emerald-ir-pack/" },
  ],
  vst3: [
    { label: "ChowDSP BYOD (drives and pedals)", url: "https://chowdsp.com/products.html" },
    { label: "Airwindows Consolidated", url: "https://www.airwindows.com/consolidated/" },
  ],
};

// The website's list of all of the above, for "more".
export const moreSoundsUrl = "https://jcjmcclean.github.io/rigbench/#sounds";

// The one link an empty slot shows. Amp models and cab IRs go straight to
// TONE3000; plugins go to the site, which lists a few to choose from.
export const findLink: Record<SlotType, SoundLink> = {
  nam: { label: "Find free amp models", url: "https://www.tone3000.com/search?format=nam" },
  ir: { label: "Find free cab IRs", url: "https://www.tone3000.com/search?format=ir" },
  vst3: { label: "Find free plugins", url: moreSoundsUrl },
};
