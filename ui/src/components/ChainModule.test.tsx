import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChainModule } from "./ChainModule";
import { findLink } from "../links";
import type { SlotState } from "../types";

function renderModule(slot: SlotState, extra: { onOpenUrl?: (url: string) => void } = {}) {
  const handlers = {
    onLoad: vi.fn(),
    onClear: vi.fn(),
    onBypass: vi.fn(),
    onMix: vi.fn(),
    onGain: vi.fn(),
    onEditor: vi.fn(),
  };
  const utils = render(<ChainModule slot={slot} index={1} {...handlers} {...extra} />);
  const article = utils.container.querySelector("article")!;
  return { ...utils, ...handlers, article };
}

const nam = (over: Partial<SlotState> = {}): SlotState =>
  ({ type: "nam", loaded: true, name: "Fig HW C50", bypassed: false, gain: 0.5, ...over });
const ir = (over: Partial<SlotState> = {}): SlotState =>
  ({ type: "ir", loaded: true, name: "Mesa 4x12 SM57", bypassed: false, mix: 1, ...over });
const vst3 = (over: Partial<SlotState> = {}): SlotState =>
  ({ type: "vst3", loaded: true, name: "SICO High Gain", bypassed: false, hasEditor: true, ...over });

describe("ChainModule header", () => {
  it.each([
    [vst3(), "VST3", "Plugin"],
    [nam(), "NAM", "Amp"],
    [ir(), "IR", "Cab"],
  ])("labels the %# slot type (%s / %s)", (slot, kind, role) => {
    renderModule(slot);
    expect(screen.getByText(kind)).toBeInTheDocument();
    expect(screen.getByText(role, { selector: ".module__role" })).toBeInTheDocument();
  });
});

describe("ChainModule loaded state", () => {
  it("shows the loaded name (with a tooltip for long names)", () => {
    renderModule(nam({ name: "A Very Long Amp Model Name" }));
    expect(screen.getByTitle("A Very Long Amp Model Name")).toHaveTextContent("A Very Long Amp Model Name");
  });

  it("offers Change and Remove, which load / clear", () => {
    const { onLoad, onClear } = renderModule(nam());
    fireEvent.click(screen.getByRole("button", { name: "Change amp model" }));
    expect(onLoad).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove amp model" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Load an? /)).not.toBeInTheDocument();
  });

  it.each([
    [vst3(), "plugin", "plugin"],
    [nam(), "amp", "amp model"],
    [ir(), "cab", "cab IR"],
  ])("names %#'s bypass, change and remove buttons after its slot (%s)", (slot, short, thing) => {
    renderModule(slot);
    // The slot's name (visually hidden) plus the visible ON/OFF: "Amp ON".
    expect(screen.getByRole("button", { name: `${short[0].toUpperCase()}${short.slice(1)} ON` })).toBeInTheDocument();
    // Change keeps its visible text; the name says which slot.
    expect(screen.getByRole("button", { name: `Change ${thing}` })).toHaveTextContent("Change");
    const remove = screen.getByRole("button", { name: `Remove ${thing}` });
    expect(remove).toHaveAttribute("title", `Remove ${thing}`);
    expect(remove).toHaveTextContent("✕");
  });

  it("an engaged slot shows ON (named \"Amp ON\") and bypasses on click", () => {
    const { onBypass } = renderModule(nam());
    const btn = screen.getByRole("button", { name: "Amp ON" });
    expect(btn).not.toHaveAttribute("aria-pressed");
    expect(btn).toHaveAttribute("title", "On: click to turn off");
    fireEvent.click(btn);
    expect(onBypass).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("a bypassed slot shows OFF (named \"Amp OFF\") and turns on on click", () => {
    const { onBypass } = renderModule(nam({ bypassed: true }));
    const btn = screen.getByRole("button", { name: "Amp OFF" });
    expect(btn).toHaveAttribute("title", "Off: click to turn on");
    fireEvent.click(btn);
    expect(onBypass).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("lights the status LED only when loaded and engaged", () => {
    const led = (a: HTMLElement) => a.querySelector(".module__led")!;
    const { article, unmount } = renderModule(nam());
    expect(led(article)).toHaveClass("jewel--lit");
    expect(article).toHaveClass("is-loaded", "is-active");
    unmount();
    const b = renderModule(nam({ bypassed: true }));
    expect(led(b.article)).not.toHaveClass("jewel--lit");
    expect(b.article).toHaveClass("is-bypassed");
    expect(b.article).not.toHaveClass("is-active");
    b.unmount();
    const e = renderModule(nam({ loaded: false }));
    expect(led(e.article)).not.toHaveClass("jewel--lit");
    expect(e.article).toHaveClass("is-empty");
  });
});

describe("ChainModule per-type controls", () => {
  it("NAM has a Level knob in signed dB that calls onGain", () => {
    const { onGain, onMix } = renderModule(nam({ gain: 0.75 }));
    const knob = screen.getByRole("slider", { name: "Level" });
    expect(knob).toHaveAttribute("aria-valuetext", "+12 dB");
    expect(screen.getByText("+12 dB")).toBeInTheDocument();
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    expect(onGain.mock.calls[0][0]).toBeCloseTo(0.8, 6);
    expect(onMix).not.toHaveBeenCalled();
    expect(screen.queryByRole("slider", { name: "Mix" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open editor/ })).not.toBeInTheDocument();
  });

  it("NAM Level defaults to 0 dB (0.5) when the engine omits gain", () => {
    renderModule(nam({ gain: undefined }));
    expect(screen.getByRole("slider", { name: "Level" })).toHaveAttribute("aria-valuetext", "+0 dB");
  });

  it("IR has a Mix knob in percent that calls onMix", () => {
    const { onGain, onMix } = renderModule(ir({ mix: 0.5 }));
    const knob = screen.getByRole("slider", { name: "Mix" });
    expect(knob).toHaveAttribute("aria-valuetext", "50%");
    fireEvent.keyDown(knob, { key: "ArrowDown" });
    expect(onMix.mock.calls[0][0]).toBeCloseTo(0.45, 6);
    expect(onGain).not.toHaveBeenCalled();
    expect(screen.queryByRole("slider", { name: "Level" })).not.toBeInTheDocument();
  });

  it("IR Mix defaults to fully wet (100%) when the engine omits mix", () => {
    renderModule(ir({ mix: undefined }));
    expect(screen.getByRole("slider", { name: "Mix" })).toHaveAttribute("aria-valuetext", "100%");
  });

  it("VST3 has an Open editor button and no knobs", () => {
    const { onEditor } = renderModule(vst3());
    fireEvent.click(screen.getByRole("button", { name: /Open editor/ }));
    expect(onEditor).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});

describe("ChainModule empty state", () => {
  it.each([
    [vst3({ loaded: false, name: "" }), "Load a plugin"],
    [nam({ loaded: false, name: "" }), "Load an amp model"],
    [ir({ loaded: false, name: "" }), "Load a cab IR"],
  ])("shows a single %#: '%s' button that loads", (slot, text) => {
    const { onLoad } = renderModule(slot);
    const btn = screen.getByRole("button", { name: new RegExp(text) });
    fireEvent.click(btn);
    expect(onLoad).toHaveBeenCalledTimes(1);
    // No bypass, change, remove, knobs or editor while empty.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});

describe("ChainModule empty state: the \"find free\" link", () => {
  const empty = { vst3: vst3({ loaded: false, name: "" }), nam: nam({ loaded: false, name: "" }), ir: ir({ loaded: false, name: "" }) };

  it.each(["vst3", "nam", "ir"] as const)("%s shows one link, inside the empty slot, opening its URL", (type) => {
    const onOpenUrl = vi.fn();
    const { onLoad, container } = renderModule(empty[type], { onOpenUrl });
    const link = screen.getByRole("button", { name: findLink[type].label });
    expect(container.querySelector(".module__empty")).toContainElement(link);
    fireEvent.click(link);
    expect(onOpenUrl).toHaveBeenCalledExactlyOnceWith(findLink[type].url);
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button")).toHaveLength(2);   // load + the link
  });

  it("amp models and cab IRs go to TONE3000; plugins go to the site's list", () => {
    expect(findLink.nam).toEqual({ label: "Find free amp models", url: "https://www.tone3000.com/search?format=nam" });
    expect(findLink.ir).toEqual({ label: "Find free cab IRs", url: "https://www.tone3000.com/search?format=ir" });
    expect(findLink.vst3.url).toBe("https://jcjmcclean.github.io/rigbench/#sounds");
  });

  it("no link without an onOpenUrl handler", () => {
    renderModule(empty.nam);
    expect(screen.queryByRole("button", { name: /Find free/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("no link on a loaded slot", () => {
    renderModule(nam(), { onOpenUrl: vi.fn() });
    expect(screen.queryByRole("button", { name: /Find free/ })).not.toBeInTheDocument();
  });
});
