import { describe, expect, it } from "vitest";
import { moreSoundsUrl, soundLinks } from "./links";
import type { SlotType } from "./types";

const SLOT_TYPES: SlotType[] = ["vst3", "nam", "ir"];
const all = Object.entries(soundLinks).flatMap(([type, links]) => links.map((l) => ({ type, ...l })));

describe("soundLinks", () => {
  it("covers exactly the slot types", () => {
    expect(Object.keys(soundLinks).sort()).toEqual([...SLOT_TYPES].sort());
  });

  it.each(SLOT_TYPES)("has at least one link for %s", (type) => {
    expect(soundLinks[type].length).toBeGreaterThan(0);
  });

  it.each(all)("$type: $label → https URL that parses", ({ label, url }) => {
    expect(label.trim()).not.toBe("");
    const u = new URL(url); // throws if it doesn't parse
    expect(u.protocol).toBe("https:");
    expect(u.hostname).toContain(".");
    expect(u.username).toBe("");
    expect(u.password).toBe("");
  });

  it("has no duplicate URLs within a slot (they key the rendered buttons)", () => {
    for (const type of SLOT_TYPES) {
      const urls = soundLinks[type].map((l) => l.url);
      expect(new Set(urls).size, type).toBe(urls.length);
    }
  });

  it("points the amp and cab slots at the right TONE3000 format filters", () => {
    expect(soundLinks.nam[0]).toEqual({ label: "Free amp models on TONE3000", url: "https://www.tone3000.com/search?format=nam" });
    expect(new URL(soundLinks.ir[0].url).searchParams.get("format")).toBe("ir");
  });
});

describe("moreSoundsUrl", () => {
  it("is an https URL", () => {
    expect(new URL(moreSoundsUrl).protocol).toBe("https:");
  });
});
