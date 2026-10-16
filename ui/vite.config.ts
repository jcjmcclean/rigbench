import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built output is embedded in the JUCE app and served from juce://juce.backend/,
// so asset URLs must be relative. `--mode showcase` instead builds the website's
// live app previews (showcase.html) into site/app/.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "./",
  build: {
    outDir: mode === "showcase" ? "../site/app" : "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2020",
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      ...(mode === "showcase" && { input: "showcase.html" }),
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: { port: 5173 },
}));
