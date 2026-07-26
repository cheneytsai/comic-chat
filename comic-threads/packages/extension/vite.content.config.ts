import { defineConfig } from "vite";

// A content script must be a single self-contained script (no import maps
// available on an arbitrary host page), so this builds to one IIFE file
// with @comic-threads/core and @comic-threads/github-source inlined.
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/content.ts",
      name: "ComicThreadsContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
});
