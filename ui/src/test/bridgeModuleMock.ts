// Drop-in replacement for the `../bridge` module in component tests:
//   vi.mock("../bridge", () => import("../test/bridgeModuleMock"));
// It exposes the shared `fake` singleton's bridge, so tests that import `fake`
// from ./fakeBridge drive and observe the same object the components use.
import { fake } from "./fakeBridge";

export const bridge = fake.bridge;
export const isMock = true;
