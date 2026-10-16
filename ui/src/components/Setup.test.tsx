import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fake, makeAudioSetup } from "../test/fakeBridge";
import { Setup } from "./Setup";
import type { AudioSetup } from "../types";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

beforeEach(() => fake.reset());

// Renders the wizard and waits for it to get past "Looking for audio devices…".
async function renderSetup() {
  const onDone = vi.fn();
  const user = userEvent.setup();
  const utils = render(<Setup onDone={onDone} />);
  await screen.findByRole("heading", { name: "What’s your guitar plugged into?" });
  return { ...utils, onDone, user };
}

const next = () => screen.getByRole("button", { name: "Next" });
const back = () => screen.getByRole("button", { name: "Back" });
const peaks = (p: number[]) => act(() => fake.emitInputPeaks(p));
const inputRow = (name: string) => within(screen.getByRole("radiogroup", { name: "Input" })).getByRole("radio", { name });

async function toInputStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(next());
  await screen.findByRole("heading", { name: "Play a few notes" });
}

async function toOutputStep(user: ReturnType<typeof userEvent.setup>) {
  await toInputStep(user);
  peaks([0.004, 0.5]);
  await user.click(next());
  await screen.findByRole("heading", { name: "Where do you want to hear it?" });
}

// A setAudioSetup that doesn't answer until the test says so.
function holdSetAudioSetup() {
  let release!: (s: AudioSetup) => void;
  fake.bridge.setAudioSetup.mockImplementationOnce(
    () => new Promise<AudioSetup>((r) => { release = r; }),
  );
  return (s: AudioSetup) => act(async () => release(s));
}

describe("Setup: loading", () => {
  it("says it's looking for devices until getAudioSetup answers", async () => {
    let answer!: (s: AudioSetup) => void;
    fake.bridge.getAudioSetup.mockImplementationOnce(() => new Promise<AudioSetup>((r) => { answer = r; }));
    render(<Setup onDone={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Setup" })).toHaveTextContent("Looking for audio devices…");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    await act(async () => answer(makeAudioSetup()));
    expect(screen.getByRole("heading", { name: "What’s your guitar plugged into?" })).toBeInTheDocument();
  });

  it("doesn't update after unmount if getAudioSetup answers late", async () => {
    let answer!: (s: AudioSetup) => void;
    fake.bridge.getAudioSetup.mockImplementationOnce(() => new Promise<AudioSetup>((r) => { answer = r; }));
    const err = vi.spyOn(console, "error");
    const { unmount } = render(<Setup onDone={() => {}} />);
    unmount();
    await act(async () => answer(makeAudioSetup()));
    expect(err).not.toHaveBeenCalled();
  });
});

describe("Setup step 1: the audio interface", () => {
  it("is a labelled modal dialog at step 1 of 3, with the heading focused", async () => {
    await renderSetup();
    const dialog = screen.getByRole("dialog", { name: "What’s your guitar plugged into?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Step 1 of 3")).toBeInTheDocument();
    // Focus moves in an effect once the devices have loaded.
    await waitFor(() => expect(screen.getByRole("heading", { name: "What’s your guitar plugged into?" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("lists the input devices with the current one checked", async () => {
    await renderSetup();
    const group = screen.getByRole("radiogroup", { name: "Audio interface" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Built-in Microphone", "Test Interface"]);
    expect(within(group).getByRole("radio", { name: "Test Interface" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "Built-in Microphone" })).toHaveAttribute("aria-checked", "false");
  });

  it("choosing a device that is also an output uses it for both", async () => {
    fake.setAudio({ inputDevices: ["Mic", "Scarlett"], outputDevices: ["Speakers", "Scarlett"], inputDevice: "Mic" });
    const { user } = await renderSetup();
    await user.click(screen.getByRole("radio", { name: "Scarlett" }));
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ inputDevice: "Scarlett", outputDevice: "Scarlett" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Scarlett" })).toHaveAttribute("aria-checked", "true"));
  });

  it("choosing an input-only device leaves the output alone", async () => {
    fake.setAudio({ inputDevices: ["Mic", "Scarlett"], outputDevices: ["Speakers"], inputDevice: "Scarlett" });
    const { user } = await renderSetup();
    await user.click(screen.getByRole("radio", { name: "Mic" }));
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ inputDevice: "Mic" });
  });

  it("warns about feedback when the input is the computer's own mic", async () => {
    fake.setAudio({ builtInInput: true });
    await renderSetup();
    expect(screen.getByText(/computer’s own microphone/)).toHaveTextContent(/headphones/);
  });

  it("shows no mic warning for an interface", async () => {
    await renderSetup();
    expect(screen.queryByText(/computer’s own microphone/)).not.toBeInTheDocument();
  });

  it("hides the driver choice when there is only one driver", async () => {
    await renderSetup();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers a driver choice when there are several, and applies it", async () => {
    fake.setAudio({ drivers: ["Windows Audio", "ASIO"], driver: "Windows Audio" });
    const { user } = await renderSetup();
    const driver = screen.getByRole("combobox", { name: "Driver" });
    expect(driver).toHaveValue("Windows Audio");
    await user.selectOptions(driver, "ASIO");
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ driver: "ASIO" });
    await waitFor(() => expect(driver).toHaveValue("ASIO"));
  });

  it("with no devices: says so, disables Next and offers Look again", async () => {
    fake.setAudio({ inputDevices: [], inputDevice: "" });
    const { user } = await renderSetup();
    expect(screen.getByText(/No audio inputs found/)).toBeInTheDocument();
    expect(next()).toBeDisabled();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);

    // The interface gets plugged in.
    fake.setAudio({ inputDevices: ["Scarlett"], inputDevice: "Scarlett" });
    await user.click(screen.getByRole("button", { name: "Look again" }));
    expect(fake.bridge.getAudioSetup).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("radio", { name: "Scarlett" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: "Look again" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No audio inputs found/)).not.toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it("disables Next when devices exist but none is chosen", async () => {
    fake.setAudio({ inputDevice: "" });
    await renderSetup();
    expect(next()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Look again" })).not.toBeInTheDocument();
  });

  it("shows the engine's error as an alert, and clears it after a change that works", async () => {
    fake.bridge.setAudioSetup.mockResolvedValueOnce({ ...(await fake.bridge.getAudioSetup()), error: "That device isn't available: Mic" });
    const { user } = await renderSetup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Built-in Microphone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That device isn't available: Mic");
    await user.click(screen.getByRole("radio", { name: "Test Interface" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("Setup step 2: finding the guitar", () => {
  it("Next opens every input to listen, and shows step 2 of 3 with its heading focused", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ listenToAllInputs: true });
    expect(screen.getByLabelText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Play a few notes" })).toHaveFocus();
    expect(screen.getByText(/Strum or pick a few notes/)).toBeInTheDocument();
  });

  it("only listens to input peaks on this step", async () => {
    const { user } = await renderSetup();
    expect(fake.bridge.subscribeInputPeaks).not.toHaveBeenCalled();
    await toInputStep(user);
    expect(fake.bridge.subscribeInputPeaks).toHaveBeenCalledTimes(1);
    peaks([0.004, 0.5]);
    await user.click(next());
    await screen.findByRole("heading", { name: "Where do you want to hear it?" });
    // Unsubscribed: later peaks don't throw or re-render the old step.
    peaks([0.9, 0]);
    expect(screen.getByRole("heading", { name: "Where do you want to hear it?" })).toBeInTheDocument();
  });

  it("lists the device's inputs, none chosen, and Next waits for one", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    expect(within(screen.getByRole("radiogroup", { name: "Input" })).getAllByRole("radio").map((r) => r.textContent))
      .toEqual(["Input 1", "Input 2"]);
    expect(inputRow("Input 1")).toHaveAttribute("aria-checked", "false");
    expect(inputRow("Input 2")).toHaveAttribute("aria-checked", "false");
    expect(next()).toBeDisabled();
  });

  it("hiss alone doesn't count as the guitar", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, 0.004]);
    peaks([0.01, 0.02]);
    expect(next()).toBeDisabled();
    expect(screen.queryByText(/Found your guitar/)).not.toBeInTheDocument();
  });

  it("picks the loudest input once it's clearly being played, with level advice", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, 0.5]);
    expect(screen.getByText("Found your guitar on Input 2.")).toBeInTheDocument();
    expect(inputRow("Input 2")).toHaveAttribute("aria-checked", "true");
    expect(inputRow("Input 1")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Good level.")).toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it("holds each input's peak (slowly decaying), so a pause doesn't lose the guitar", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, 0.5]);
    for (let i = 0; i < 20; i++) peaks([0.004, 0.004]);
    expect(screen.getByText("Found your guitar on Input 2.")).toBeInTheDocument();
  });

  it("moves to a louder input if one comes along", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.2, 0.004]);
    expect(screen.getByText("Found your guitar on Input 1.")).toBeInTheDocument();
    peaks([0.004, 0.7]);
    expect(screen.getByText("Found your guitar on Input 2.")).toBeInTheDocument();
  });

  it("draws each input's level bar", async () => {
    const { user, container } = await renderSetup();
    await toInputStep(user);
    peaks([0.25, 1]);
    const fills = [...container.querySelectorAll<HTMLElement>(".inputs__fill")].map((f) => f.style.width);
    expect(fills).toEqual(["50%", "100%"]);
  });

  it.each([
    [0.06, /^Good level\.$/],
    [0.5, /^Good level\.$/],
    [0.99, /Too loud/],
  ])("level advice for a peak of %s", async (level, advice) => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, level]);
    expect(screen.getByText(advice)).toBeInTheDocument();
  });

  it("advises turning up a quiet input (hand-picked: too quiet to be auto-found)", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, 0.02]);
    expect(next()).toBeDisabled();
    await user.click(inputRow("Input 2"));
    expect(screen.getByText(/Quite quiet/)).toHaveTextContent(/Hi-Z/);
  });

  it("no level advice before anything is chosen", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, 0.004]);
    expect(screen.queryByText(/Good level|Quite quiet|Too loud/)).not.toBeInTheDocument();
  });

  it("a hand-picked input wins over the auto-pick, and Next applies it", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, 0.6]);
    await user.click(inputRow("Input 1"));
    expect(inputRow("Input 1")).toHaveAttribute("aria-checked", "true");
    expect(inputRow("Input 2")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Found your guitar on Input 1.")).toBeInTheDocument();
    // Louder playing elsewhere doesn't take it back.
    peaks([0.004, 0.9]);
    expect(inputRow("Input 1")).toHaveAttribute("aria-checked", "true");
    // The advice is about the hand-picked input, which is only hissing.
    expect(screen.getByText(/Quite quiet/)).toBeInTheDocument();
    fake.bridge.setAudioSetup.mockClear();
    await user.click(next());
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ input: 0 });
  });

  it("hand-picking works with no signal at all", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    await user.click(inputRow("Input 2"));
    expect(next()).toBeEnabled();
    fake.bridge.setAudioSetup.mockClear();
    await user.click(next());
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ input: 1 });
  });

  it("Next applies the auto-picked input", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, 0.5]);
    fake.bridge.setAudioSetup.mockClear();
    await user.click(next());
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ input: 1 });
    expect(await screen.findByRole("heading", { name: "Where do you want to hear it?" })).toBeInTheDocument();
  });

  it("shows at most 16 inputs", async () => {
    fake.setAudio({ inputs: Array.from({ length: 24 }, (_, i) => `In ${i + 1}`) });
    const { user } = await renderSetup();
    await toInputStep(user);
    const rows = within(screen.getByRole("radiogroup", { name: "Input" })).getAllByRole("radio");
    expect(rows).toHaveLength(16);
    expect(rows.at(-1)).toHaveTextContent("In 16");
  });

  it("says so when the device has no inputs", async () => {
    fake.setAudio({ inputs: [] });
    const { user } = await renderSetup();
    await toInputStep(user);
    expect(screen.getByText(/This device has no inputs/)).toBeInTheDocument();
    expect(next()).toBeDisabled();
  });

  it("Back returns to step 1; coming forward again starts fresh", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    await user.click(inputRow("Input 1"));
    await user.click(back());
    expect(await screen.findByRole("heading", { name: "What’s your guitar plugged into?" })).toHaveFocus();
    await toInputStep(user);
    expect(inputRow("Input 1")).toHaveAttribute("aria-checked", "false");
    expect(next()).toBeDisabled();
    expect(fake.bridge.setAudioSetup.mock.calls.filter(([c]) => c.listenToAllInputs)).toHaveLength(2);
  });

  it("disables Back and Next while a change is being applied", async () => {
    const { user } = await renderSetup();
    await toInputStep(user);
    peaks([0.004, 0.5]);
    const release = holdSetAudioSetup();
    await user.click(next());
    expect(next()).toBeDisabled();
    expect(back()).toBeDisabled();
    await release(makeAudioSetup({ input: 1 }));
    expect(await screen.findByRole("heading", { name: "Where do you want to hear it?" })).toBeInTheDocument();
  });
});

describe("Setup step 3: the output", () => {
  it("lists the outputs with the current one checked; choosing one applies it", async () => {
    const { user } = await renderSetup();
    await toOutputStep(user);
    expect(screen.getByLabelText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Where do you want to hear it?" })).toHaveFocus();
    const group = screen.getByRole("radiogroup", { name: "Output" });
    expect(within(group).getByRole("radio", { name: "Test Interface" })).toHaveAttribute("aria-checked", "true");
    fake.bridge.setAudioSetup.mockClear();
    await user.click(within(group).getByRole("radio", { name: "Built-in Output" }));
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ outputDevice: "Built-in Output" });
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Built-in Output" })).toHaveAttribute("aria-checked", "true"));
  });

  it("plays a test sound", async () => {
    const { user } = await renderSetup();
    await toOutputStep(user);
    await user.click(screen.getByRole("button", { name: "Play test sound" }));
    expect(fake.bridge.playTestSound).toHaveBeenCalledTimes(1);
  });

  it("replaces Next with Start playing, which finishes setup", async () => {
    const { user, onDone } = await renderSetup();
    await toOutputStep(user);
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start playing" }));
    expect(fake.bridge.finishSetup).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Back to the input step listens to every input again and re-finds the guitar", async () => {
    // Regression: after step 3 the engine has only the chosen input open, so
    // going back without re-opening every input misattributes its level to Input 1.
    const { user } = await renderSetup();
    await toOutputStep(user);
    fake.bridge.setAudioSetup.mockClear();
    await user.click(back());
    expect(await screen.findByRole("heading", { name: "Play a few notes" })).toBeInTheDocument();
    expect(fake.bridge.setAudioSetup).toHaveBeenCalledExactlyOnceWith({ listenToAllInputs: true });
    peaks([0.004, 0.5]);
    expect(screen.getByText("Found your guitar on Input 2.")).toBeInTheDocument();
  });
});

describe("Setup: Skip", () => {
  it.each([1, 2, 3])("Skip setup on step %i finishes setup", async (step) => {
    const { user, onDone } = await renderSetup();
    if (step >= 2) await toInputStep(user);
    if (step >= 3) {
      peaks([0, 0.5]);
      await user.click(next());
      await screen.findByRole("heading", { name: "Where do you want to hear it?" });
    }
    await user.click(screen.getByRole("button", { name: "Skip setup" }));
    expect(fake.bridge.finishSetup).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
