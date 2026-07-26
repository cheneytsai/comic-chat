import { defineConfig } from "vite";

// Same reasoning as vite.content.config.ts — one self-contained script, this
// time for the service worker. Built as a plain script (not `type: "module"`
// in manifest.json) so it doesn't depend on MV3 module-worker support.
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/background.ts",
      name: "ComicThreadsBackground",
      formats: ["iife"],
      fileName: () => "background.js",
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
});
