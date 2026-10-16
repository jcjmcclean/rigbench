import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { fake, makeState } from "../test/fakeBridge";
import { SignalChain } from "./SignalChain";
import type { EngineState, SlotType } from "../types";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

beforeEach(() => fake.reset());

const KIND: Record<SlotType, string> = { vst3: "VST3", nam: "NAM", ir: "IR" };
function slot(type: SlotType) {
  return within(screen.getByText(KIND[type], { selector: ".module__kind" }).closest("article")!);
}

function fullRig(over: Partial<EngineState> = {}) {
  return makeState({
    slots: {
      vst3: { type: "vst3", loaded: true, name: "SICO High Gain", bypassed: false, hasEditor: true },
      nam: { type: "nam", loaded: true, name: "Amp Model A", bypassed: false, gain: 0.5 },
      ir: { type: "ir", loaded: true, name: "Cab IR A", bypassed: false, mix: 1 },
    },
    ...over,
  });
}

describe("SignalChain layout", () => {
  it("renders the three slots in signal order: VST3 -> NAM -> IR", () => {
    const { container } = render(<SignalChain state={makeState()} />);
    const kinds = [...container.querySelectorAll("article .module__kind")].map((e) => e.textContent);
    expect(kinds).toEqual(["VST3", "NAM", "IR"]);
  });

  it("shows input Gain and output Master knobs as 0-100", () => {
    render(<SignalChain state={makeState({ inputGain: 0.8, masterGain: 0.35 })} />);
    expect(screen.getByRole("slider", { name: "Gain" })).toHaveAttribute("aria-valuetext", "80");
    expect(screen.getByRole("slider", { name: "Master" })).toHaveAttribute("aria-valuetext", "35");
  });

  it("drives the IN/OUT meters from inputLevel/outputLevel (on a dB scale)", () => {
    // -30 dBFS is half way up a -60..0 dB meter; full scale lights everything.
    const { container } = render(<SignalChain state={makeState({ inputLevel: 10 ** (-30 / 20), outputLevel: 1 })} />);
    const lit = (sel: string) => container.querySelectorAll(`${sel} .meter__seg.is-on`).length;
    expect(lit(".terminal--in")).toBe(7);
    expect(lit(".terminal--out")).toBe(14);
    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(screen.getByText("OUT")).toBeInTheDocument();
  });

  it("feeds the cable animation from the output level only while playing", () => {
    const { container, rerender } = render(<SignalChain state={makeState({ playing: true, outputLevel: 0.6 })} />);
    const chain = container.querySelector(".chain") as HTMLElement;
    expect(chain.style.getPropertyValue("--flow")).toBe("0.6");
    expect(container.querySelectorAll(".connector.is-live")).toHaveLength(4);
    rerender(<SignalChain state={makeState({ playing: false, outputLevel: 0.6 })} />);
    expect(chain.style.getPropertyValue("--flow")).toBe("0");
    expect(container.querySelectorAll(".connector.is-live")).toHaveLength(0);
  });

  it("subscribes the scope to the engine", () => {
    render(<SignalChain state={makeState()} />);
    expect(fake.counts().scope).toBe(1);
  });
});

describe("SignalChain -> bridge wiring", () => {
  it("terminal knobs call setInput / setMaster", () => {
    render(<SignalChain state={makeState({ inputGain: 0.5, masterGain: 0.5 })} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Gain" }), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Master" }), { key: "ArrowDown" });
    expect(fake.bridge.setInput.mock.calls[0][0]).toBeCloseTo(0.55, 6);
    expect(fake.bridge.setMaster.mock.calls[0][0]).toBeCloseTo(0.45, 6);
    expect(fake.bridge.setGain).not.toHaveBeenCalled();
  });

  it("the input Gate knob reads Off by default and calls setGate", () => {
    render(<SignalChain state={makeState({ gate: 0 })} />);
    const gate = screen.getByRole("slider", { name: "Gate" });
    expect(gate).toHaveAttribute("aria-valuetext", "Off");
    fireEvent.keyDown(gate, { key: "ArrowUp" });
    expect(fake.bridge.setGate.mock.calls[0][0]).toBeCloseTo(0.05, 6);
  });

  it("the Gate knob shows its threshold once on", () => {
    render(<SignalChain state={makeState({ gate: 0.5 })} />);
    expect(screen.getByRole("slider", { name: "Gate" })).toHaveAttribute("aria-valuetext", "-50 dB");
  });

  it.each<SlotType>(["vst3", "nam", "ir"])("bypass on %s calls setBypass with that slot", (type) => {
    render(<SignalChain state={fullRig()} />);
    fireEvent.click(slot(type).getByRole("button", { name: "ON" }));
    expect(fake.bridge.setBypass).toHaveBeenCalledExactlyOnceWith(type, true);
  });

  it("engaging a bypassed slot calls setBypass(slot, false)", () => {
    const s = fullRig();
    s.slots.ir = { ...s.slots.ir, bypassed: true };
    render(<SignalChain state={s} />);
    fireEvent.click(slot("ir").getByRole("button", { name: "BYPASS" }));
    expect(fake.bridge.setBypass).toHaveBeenCalledExactlyOnceWith("ir", false);
  });

  it.each<SlotType>(["vst3", "nam", "ir"])("Change on %s calls loadSlot with that slot", (type) => {
    render(<SignalChain state={fullRig()} />);
    fireEvent.click(slot(type).getByRole("button", { name: "Change" }));
    expect(fake.bridge.loadSlot).toHaveBeenCalledExactlyOnceWith(type);
  });

  it.each<SlotType>(["vst3", "nam", "ir"])("Remove on %s calls clearSlot with that slot", (type) => {
    render(<SignalChain state={fullRig()} />);
    fireEvent.click(slot(type).getByTitle("Remove"));
    expect(fake.bridge.clearSlot).toHaveBeenCalledExactlyOnceWith(type);
  });

  it("an empty slot's load button calls loadSlot with that slot", () => {
    render(<SignalChain state={makeState()} />); // vst3 empty in the default fixture
    fireEvent.click(screen.getByRole("button", { name: /Load a plugin/ }));
    expect(fake.bridge.loadSlot).toHaveBeenCalledExactlyOnceWith("vst3");
  });

  it("NAM Level calls setGain('nam', v); IR Mix calls setMix('ir', v)", () => {
    render(<SignalChain state={fullRig()} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Level" }), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Mix" }), { key: "ArrowDown" });
    expect(fake.bridge.setGain).toHaveBeenCalledExactlyOnceWith("nam", expect.closeTo(0.55, 6));
    expect(fake.bridge.setMix).toHaveBeenCalledExactlyOnceWith("ir", expect.closeTo(0.95, 6));
  });

  it("an empty slot's download link calls openUrl with its URL", () => {
    const s = fullRig();
    s.slots.ir = { ...s.slots.ir, loaded: false, name: "" };
    render(<SignalChain state={s} />);
    fireEvent.click(slot("ir").getByRole("button", { name: "Free cab IRs on TONE3000" }));
    expect(fake.bridge.openUrl).toHaveBeenCalledExactlyOnceWith("https://www.tone3000.com/search?format=ir");
    expect(fake.bridge.loadSlot).not.toHaveBeenCalled();
  });

  it("only empty slots show download links", () => {
    render(<SignalChain state={makeState()} />); // vst3 empty, nam + ir loaded
    expect(screen.getAllByText("Don’t have one?")).toHaveLength(1);
    expect(slot("vst3").getByText("Don’t have one?")).toBeInTheDocument();
  });

  it("Open editor calls openEditor", () => {
    render(<SignalChain state={fullRig()} />);
    fireEvent.click(screen.getByRole("button", { name: /Open editor/ }));
    expect(fake.bridge.openEditor).toHaveBeenCalledTimes(1);
  });
});
