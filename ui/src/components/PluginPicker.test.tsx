import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fake } from "../test/fakeBridge";
import { soundLinks } from "../links";
import { PluginPicker } from "./PluginPicker";
import type { PluginInfo } from "../types";

vi.mock("../bridge", () => import("../test/bridgeModuleMock"));

beforeEach(() => fake.reset());

const many = (n: number): PluginInfo[] =>
  Array.from({ length: n }, (_, i) => ({ name: `Plugin ${i + 1}`, path: `/p/Plugin ${i + 1}.vst3` }));

describe("PluginPicker", () => {
  it("says it's looking until the list arrives", async () => {
    let answer!: (p: PluginInfo[]) => void;
    fake.bridge.listPlugins.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    render(<PluginPicker onClose={() => {}} />);
    expect(screen.getByText("Looking for plugins…")).toBeInTheDocument();
    await act(async () => answer(many(2)));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("loads the picked plugin by its path and closes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PluginPicker onClose={onClose} />);
    await user.click(await screen.findByRole("button", { name: "Dragonfly Plate Reverb" }));
    expect(fake.bridge.loadPlugin).toHaveBeenCalledExactlyOnceWith("/Plug-Ins/VST3/Dragonfly Plate Reverb.vst3");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Browse… opens the file chooser for the plugin slot", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PluginPicker onClose={onClose} />);
    await screen.findByRole("list", { name: "Installed plugins" });
    await user.click(screen.getByRole("button", { name: "Browse…" }));
    expect(fake.bridge.loadSlot).toHaveBeenCalledExactlyOnceWith("vst3");
    expect(onClose).toHaveBeenCalled();
  });

  it("with nothing installed, suggests free plugins to download", async () => {
    fake.bridge.listPlugins.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<PluginPicker onClose={() => {}} />);
    expect(await screen.findByText(/No VST3 plugins in the usual folders/)).toBeInTheDocument();
    const first = soundLinks.vst3[0];
    await user.click(screen.getByRole("button", { name: first.label }));
    expect(fake.bridge.openUrl).toHaveBeenCalledExactlyOnceWith(first.url);
    expect(screen.getByRole("button", { name: "Browse…" })).toBeInTheDocument();
  });

  it("offers a filter once the list is long, and says when nothing matches", async () => {
    fake.bridge.listPlugins.mockResolvedValueOnce(many(12));
    const user = userEvent.setup();
    render(<PluginPicker onClose={() => {}} />);
    const filter = await screen.findByRole("textbox", { name: "Filter plugins" });
    expect(filter).toHaveFocus();
    await user.type(filter, "plugin 1");
    const list = screen.getByRole("list", { name: "Installed plugins" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Plugin 1", "Plugin 10", "Plugin 11", "Plugin 12",
    ]);
    await user.clear(filter);
    await user.type(filter, "zzz");
    expect(screen.getByText("Nothing matches “zzz”.")).toBeInTheDocument();
  });

  it("has no filter for a short list", async () => {
    render(<PluginPicker onClose={() => {}} />);
    await screen.findByRole("list", { name: "Installed plugins" });
    expect(screen.queryByRole("textbox", { name: "Filter plugins" })).not.toBeInTheDocument();
  });

  it("ignores a list that arrives after it was closed", async () => {
    let answer!: (p: PluginInfo[]) => void;
    fake.bridge.listPlugins.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const { unmount } = render(<PluginPicker onClose={() => {}} />);
    unmount();
    await act(async () => answer(many(3)));
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
