import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fake, makeAudioSetup } from "../test/fakeBridge";
import { Settings } from "./Settings";
import type { AudioSetup } from "../types";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

beforeEach(() => fake.reset());

async function renderSettings() {
  const onClose = vi.fn();
  const onRunSetup = vi.fn();
  const user = userEvent.setup();
  const utils = render(<Settings onClose={onClose} onRunSetup={onRunSetup} />);
  await screen.findByRole("status");
  return { ...utils, onClose, onRunSetup, user };
}

const select = (label: string) => screen.getByRole("combobox", { name: label }) as HTMLSelectElement;
const optionTexts = (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent);
const selectedText = (el: HTMLSelectElement) => el.options[el.selectedIndex]?.textContent;

describe("Settings: loading and status", () => {
  it("is a dialog titled Settings that shows a loading line until the setup arrives", async () => {
    let answer!: (s: AudioSetup) => void;
    fake.bridge.getAudioSetup.mockImplementationOnce(() => new Promise<AudioSetup>((r) => { answer = r; }));
    render(<Settings onClose={() => {}} onRunSetup={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveTextContent("Looking for audio devices…");
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    // The actions are there straight away.
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    await act(async () => answer(makeAudioSetup()));
    expect(screen.getByRole("status")).toHaveTextContent("Working");
  });

  it("doesn't update after unmount if the setup arrives late", async () => {
    let answer!: (s: AudioSetup) => void;
    fake.bridge.getAudioSetup.mockImplementationOnce(() => new Promise<AudioSetup>((r) => { answer = r; }));
    const err = vi.spyOn(console, "error");
    const { unmount } = render(<Settings onClose={() => {}} onRunSetup={() => {}} />);
    unmount();
    await act(async () => answer(makeAudioSetup()));
    expect(err).not.toHaveBeenCalled();
  });

  it("says it's working, with the rate and rounded delay", async () => {
    fake.setAudio({ sampleRate: 44100, latencyMs: 6.6 });
    await renderSettings();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Working · 44.1 kHz · about 7 ms delay");
    expect(status).toHaveClass("is-ok");
  });

  it("says when no device is running", async () => {
    fake.setAudio({ sampleRate: 0, latencyMs: 0 });
    await renderSettings();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No audio device is running. Pick one below.");
    expect(status).not.toHaveClass("is-ok");
  });

  it("shows an error from opening the device as an alert", async () => {
    fake.setAudio({ sampleRate: 0, error: "The audio device couldn't be opened." });
    await renderSettings();
    expect(screen.getByRole("alert")).toHaveTextContent("The audio device couldn't be opened.");
  });

  it("shows no alert when all is well", async () => {
    await renderSettings();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Settings: the choices", () => {
  it("shows the input device, with every device listed", async () => {
    await renderSettings();
    const el = select("Guitar comes in from");
    expect(el).toHaveValue("Test Interface");
    expect(optionTexts(el)).toEqual(["Built-in Microphone", "Test Interface"]);
  });

  it("shows the input channel by name", async () => {
    fake.setAudio({ input: 1 });
    await renderSettings();
    const el = select("Guitar is plugged into");
    expect(el).toHaveValue("1");
    expect(selectedText(el)).toBe("Input 2");
    expect(optionTexts(el)).toEqual(["Input 1", "Input 2"]);
  });

  it("asks for an input when none is chosen (-1)", async () => {
    fake.setAudio({ input: -1 });
    await renderSettings();
    const el = select("Guitar is plugged into");
    expect(el).toHaveValue("");
    expect(selectedText(el)).toBe("Choose an input");
    expect(el.options[0]).toBeDisabled();
  });

  it("shows a 'None' placeholder for a device that isn't in the list", async () => {
    fake.setAudio({ outputDevice: "" });
    await renderSettings();
    const el = select("You hear it through");
    expect(el).toHaveValue("");
    expect(selectedText(el)).toBe("None");
  });

  it("shows the output device", async () => {
    await renderSettings();
    const el = select("You hear it through");
    expect(el).toHaveValue("Test Interface");
    expect(optionTexts(el)).toEqual(["Built-in Output", "Test Interface"]);
  });

  it("labels buffer sizes with their time at the current rate", async () => {
    await renderSettings();
    const el = select("Responsiveness");
    expect(el).toHaveValue("128");
    expect(optionTexts(el)).toEqual(["64 samples · 1.3 ms", "128 samples · 2.7 ms", "256 samples · 5.3 ms"]);
    expect(screen.getByText(/Lower is snappier/)).toBeInTheDocument();
  });

  it("puts sample rate under Advanced, labelled in kHz", async () => {
    await renderSettings();
    const advanced = screen.getByText("Advanced").closest("details")!;
    const el = within(advanced).getByRole("combobox", { name: "Sample rate" }) as HTMLSelectElement;
    expect(el).toHaveValue("48000");
    expect(optionTexts(el)).toEqual(["44.1 kHz", "48 kHz"]);
  });

  it("hides the driver choice when there's only one driver", async () => {
    await renderSettings();
    expect(screen.queryByRole("combobox", { name: "Driver" })).not.toBeInTheDocument();
  });

  it("offers the driver under Advanced when there are several", async () => {
    fake.setAudio({ drivers: ["Windows Audio", "ASIO"], driver: "ASIO" });
    await renderSettings();
    const advanced = screen.getByText("Advanced").closest("details")!;
    expect(within(advanced).getByRole("combobox", { name: "Driver" })).toHaveValue("ASIO");
  });

  it("warns about feedback when the input is the computer's own mic", async () => {
    fake.setAudio({ builtInInput: true });
    await renderSettings();
    expect(screen.getByText(/computer’s own microphone/)).toHaveTextContent(/headphones/);
  });

  it("no mic warning for an interface", async () => {
    await renderSettings();
    expect(screen.queryByText(/computer’s own microphone/)).not.toBeInTheDocument();
  });
});

describe("Settings: changes go to the engine, one key at a time", () => {
  it.each([
    ["Guitar comes in from", "Built-in Microphone", { inputDevice: "Built-in Microphone" }],
    ["Guitar is plugged into", "1", { input: 1 }],
    ["You hear it through", "Built-in Output", { outputDevice: "Built-in Output" }],
    ["Responsiveness", "256", { bufferSize: 256 }],
    ["Sample rate", "44100", { sampleRate: 44100 }],
  ] as const)("%s → %s", async (label, value, changes) => {
    const { user } = await renderSettings();
    await user.selectOptions(select(label), value);
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith(changes);
    await waitFor(() => expect(select(label)).toHaveValue(value));
  });

  it("Driver → ASIO", async () => {
    fake.setAudio({ drivers: ["Windows Audio", "ASIO"], driver: "Windows Audio" });
    const { user } = await renderSettings();
    await user.selectOptions(select("Driver"), "ASIO");
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ driver: "ASIO" });
  });

  it("numbers are sent as numbers, not strings", async () => {
    await renderSettings();
    fireEvent.change(select("Responsiveness"), { target: { value: "64" } });
    const [changes] = fake.bridge.setAudioSetup.mock.calls[0];
    expect(changes.bufferSize).toBe(64);
    expect(typeof changes.bufferSize).toBe("number");
  });

  it("re-labels buffer sizes when the sample rate changes", async () => {
    const { user } = await renderSettings();
    await user.selectOptions(select("Sample rate"), "44100");
    await waitFor(() => expect(optionTexts(select("Responsiveness"))[1]).toBe("128 samples · 2.9 ms"));
  });

  it("is busy while a change is applied", async () => {
    let release!: (s: AudioSetup) => void;
    fake.bridge.setAudioSetup.mockImplementationOnce(() => new Promise<AudioSetup>((r) => { release = r; }));
    const { user, container } = await renderSettings();
    const body = container.ownerDocument.querySelector(".settings")!;
    expect(body).toHaveAttribute("aria-busy", "false");
    await user.selectOptions(select("Responsiveness"), "256");
    expect(body).toHaveAttribute("aria-busy", "true");
    await act(async () => release(makeAudioSetup({ bufferSize: 256 })));
    expect(body).toHaveAttribute("aria-busy", "false");
    expect(select("Responsiveness")).toHaveValue("256");
  });

  it("shows an error the change came back with, and clears it on the next good change", async () => {
    fake.bridge.setAudioSetup.mockResolvedValueOnce(makeAudioSetup({ error: "That buffer size isn't valid." }));
    const { user } = await renderSettings();
    await user.selectOptions(select("Responsiveness"), "256");
    expect(await screen.findByRole("alert")).toHaveTextContent("That buffer size isn't valid.");
    await user.selectOptions(select("Responsiveness"), "64");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("updates the status line from what the engine says after a change", async () => {
    fake.bridge.setAudioSetup.mockResolvedValueOnce(makeAudioSetup({ sampleRate: 0 }));
    const { user } = await renderSettings();
    await user.selectOptions(select("Guitar comes in from"), "Built-in Microphone");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No audio device is running"));
  });
});

describe("Settings: test sound and input meter", () => {
  it("Test sound plays the test sound", async () => {
    const { user } = await renderSettings();
    await user.click(screen.getByRole("button", { name: "Test sound" }));
    expect(fake.bridge.playTestSound).toHaveBeenCalledTimes(1);
    expect(fake.bridge.setAudioSetup).not.toHaveBeenCalled();
  });

  it("meters the guitar's input live, and stops listening when closed", async () => {
    const { container, unmount } = await renderSettings();
    expect(fake.bridge.subscribeInputPeaks).toHaveBeenCalledTimes(1);
    const fill = () => (container.ownerDocument.querySelector(".settings__meter > span") as HTMLElement).style.width;
    expect(fill()).toBe("0%");
    act(() => fake.emitInputPeaks([0.25]));
    expect(fill()).toBe("50%");
    act(() => fake.emitInputPeaks([4]));
    expect(fill()).toBe("100%");
    act(() => fake.emitInputPeaks([]));
    expect(fill()).toBe("0%");
    unmount();
    expect(() => fake.emitInputPeaks([0.5])).not.toThrow();
  });
});

describe("Settings: closing", () => {
  it("Done closes", async () => {
    const { user, onClose, onRunSetup } = await renderSettings();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRunSetup).not.toHaveBeenCalled();
  });

  it("Escape closes", async () => {
    const { user, onClose } = await renderSettings();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Run setup again asks to run setup", async () => {
    const { user, onClose, onRunSetup } = await renderSettings();
    await user.click(screen.getByRole("button", { name: "Run setup again" }));
    expect(onRunSetup).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is a wide modal", async () => {
    await renderSettings();
    expect(screen.getByRole("dialog", { name: "Settings" })).toHaveClass("modal--wide");
  });
});
