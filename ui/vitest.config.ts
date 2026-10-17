import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dedicated test config (kept separate from vite.config.ts so the production
// build is untouched). jsdom gives bridge/component tests a DOM; restoreMocks
// resets spies between tests so the module-level JUCE mock can't leak state.
// Playwright specs live in e2e/ and run via `npm run test:e2e`, never here.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        // Entry points: DOM bootstrapping only, exercised by the e2e suite.
        "src/main.tsx",
        "src/showcase.tsx",
      ],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
