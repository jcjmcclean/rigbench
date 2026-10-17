import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: the real app in a real browser, driven by the in-browser
// mock engine (no JUCE). `npm run test:e2e` starts the Vite dev server itself.
// Locally an already-running `npm run dev` on the port is reused; if something
// else owns 5173, run with E2E_PORT=<free port> (the specs check the page title,
// so a foreign server fails fast instead of producing confusing errors).
const PORT = Number(process.env.E2E_PORT ?? 5173);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
