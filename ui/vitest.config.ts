import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dedicated test config (kept separate from vite.config.ts so the production
// build is untouched). jsdom gives bridge/component tests a DOM; restoreMocks
// resets spies between tests so the module-level JUCE mock can't leak state.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
