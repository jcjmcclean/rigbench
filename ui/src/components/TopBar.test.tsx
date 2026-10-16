import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { fake, makeState } from "../test/fakeBridge";
import { TopBar } from "./TopBar";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

beforeEach(() => fake.reset());

// Telemetry values are rendered as label/value pairs; find the value next to a label.
function telem(label: string) {
  const el = screen.getByText(label, { selector: ".telem__label" });
  return el.nextElementSibling as HTMLElement;
}

describe("TopBar telemetry", () => {
  it("shows the device, sample rate in kHz, buffer size and latency", () => {
    render(<TopBar state={makeState({ device: "Apollo Twin", sampleRate: 44100, bufferSize: 256, roundTripMs: 5.25 })} dirty={false} />);
    expect(telem("Device")).toHaveTextContent("Apollo Twin");
    expect(telem("Rate")).toHaveTextContent("44.1 kHz");
    expect(telem("Buffer")).toHaveTextContent(/^256$/);
    expect(telem("Latency")).toHaveTextContent("5.3 ms · low");
  });

  it("formats 48 kHz with one decimal", () => {
    render(<TopBar state={makeState({ sampleRate: 48000 })} dirty={false} />);
    expect(telem("Rate")).toHaveTextContent("48.0 kHz");
  });

  it.each([
    [0, "0.0 ms · low", "good"],
    [11.9, "11.9 ms · low", "good"],
    [12, "12.0 ms · med", "warn"],
    [19.9, "19.9 ms · med", "warn"],
    [20, "20.0 ms · high", "bad"],
    [85.04, "85.0 ms · high", "bad"],
  ])("latency %s ms reads %j with a %s tone (word + colour, not colour only)", (ms, text, tone) => {
    render(<TopBar state={makeState({ roundTripMs: ms })} dirty={false} />);
    expect(telem("Latency")).toHaveTextContent(text);
    expect(telem("Latency")).toHaveClass(`telem__value--${tone}`);
  });

  it("shows the brand", () => {
    render(<TopBar state={makeState()} dirty={false} />);
    expect(screen.getByRole("banner")).toHaveTextContent(/^Tonebench/);
  });
});

describe("TopBar monitoring (LIVE) toggle", () => {
  it("reads Live while monitoring and mutes on click", () => {
    render(<TopBar state={makeState({ monitoring: true })} dirty={false} />);
    const btn = screen.getByRole("button", { name: /Live/ });
    expect(btn).toHaveAttribute("title", "Monitoring on — click to mute");
    fireEvent.click(btn);
    expect(fake.bridge.setMonitor).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("reads Muted when not monitoring and un-mutes on click", () => {
    render(<TopBar state={makeState({ monitoring: false })} dirty={false} />);
    const btn = screen.getByRole("button", { name: /Muted/ });
    expect(screen.queryByRole("button", { name: /Live/ })).not.toBeInTheDocument();
    expect(btn).toHaveAttribute("title", "Monitoring off");
    fireEvent.click(btn);
    expect(fake.bridge.setMonitor).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe("TopBar settings", () => {
  it("asks its owner to open Settings", () => {
    const onOpenSettings = vi.fn();
    render(<TopBar state={makeState()} dirty={false} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(fake.bridge.setMonitor).not.toHaveBeenCalled();
  });

  it("the gear is harmless without a handler", () => {
    render(<TopBar state={makeState()} dirty={false} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Settings" }))).not.toThrow();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("title", "Settings");
  });
});

describe("TopBar with no audio device", () => {
  it("says so instead of showing zeros", () => {
    render(<TopBar state={makeState({ sampleRate: 0, bufferSize: 0, roundTripMs: 0, device: "No device" })} dirty={false} />);
    expect(screen.getByText("No audio device")).toBeInTheDocument();
    expect(screen.queryByText(/0\.0 kHz/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ms ·/)).not.toBeInTheDocument();
  });

  it("shows a dash for rate, buffer and latency, and flags the device in the 'bad' tone", () => {
    render(<TopBar state={makeState({ sampleRate: 0, bufferSize: 512, roundTripMs: 30, device: "Scarlett" })} dirty={false} />);
    expect(telem("Device")).toHaveTextContent(/^No audio device$/);
    expect(telem("Device")).toHaveClass("telem__value--bad");
    expect(telem("Rate")).toHaveTextContent(/^—$/);
    expect(telem("Buffer")).toHaveTextContent(/^—$/);
    expect(telem("Latency")).toHaveTextContent(/^—$/);
    // No latency colour (a stale 30 ms "high" would be misleading).
    expect(telem("Latency").className).not.toMatch(/telem__value--/);
    expect(screen.queryByText("Scarlett")).not.toBeInTheDocument();
  });

  it("a running device shows its name without a warning tone", () => {
    render(<TopBar state={makeState({ device: "Scarlett" })} dirty={false} />);
    expect(telem("Device")).toHaveTextContent("Scarlett");
    expect(telem("Device").className).not.toMatch(/telem__value--/);
  });
});

describe("TopBar preset + edited marker", () => {
  it("shows the active preset without an edited marker when clean", () => {
    render(<TopBar state={makeState({ activePreset: "Crunch" })} dirty={false} />);
    const trigger = screen.getByRole("button", { name: /Preset/ });
    expect(trigger).toHaveTextContent("Crunch");
    expect(within(trigger).queryByText(/edited/)).not.toBeInTheDocument();
  });

  it("marks the preset as edited when dirty", () => {
    render(<TopBar state={makeState({ activePreset: "Crunch" })} dirty />);
    const trigger = screen.getByRole("button", { name: /Preset/ });
    expect(within(trigger).getByTitle("Unsaved changes")).toHaveTextContent("• edited");
  });

  it("passes the preset list to the menu", () => {
    render(<TopBar state={makeState({ presets: ["One", "Two"], activePreset: null })} dirty={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Preset/ }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["One", "Two", "+ Save current rig…"]);
  });

  it("forwards preset saves to onPresetSaved", () => {
    const onPresetSaved = vi.fn();
    render(<TopBar state={makeState({ activePreset: "Crunch" })} dirty onPresetSaved={onPresetSaved} />);
    fireEvent.click(screen.getByRole("button", { name: /Preset/ }));
    fireEvent.click(screen.getByRole("option", { name: "+ Save current rig…" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(fake.bridge.savePreset).toHaveBeenCalledExactlyOnceWith("Crunch copy");
    expect(onPresetSaved).toHaveBeenCalledExactlyOnceWith("Crunch copy");
  });
});
