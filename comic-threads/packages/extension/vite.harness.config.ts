import { defineConfig } from "vite";

// Dev-only render harness (see dev/harness.ts) — not part of the shipped
// extension build (package.json's "build" script never calls this).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: { input: "dev/harness.html" },
  },
});
