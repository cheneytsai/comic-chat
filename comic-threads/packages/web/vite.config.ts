import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

/**
 * `assets/` (extracted character art + fixtures) is served verbatim as the
 * static root: in dev Vite serves it from disk, and on `vite build` the whole
 * tree is copied into `dist/`. That means one code path for both — the app
 * always fetches `${BASE_URL}characters/<name>/manifest.json` and
 * `${BASE_URL}fixtures/demo-thread.json`, with no bundler-specific asset URLs
 * and no 22 manifests baked into the JS bundle.
 */
const assetsDir = fileURLToPath(new URL("../../assets", import.meta.url));

export default defineConfig({
  plugins: [preact()],
  publicDir: assetsDir,
  base: process.env.COMIC_THREADS_BASE ?? "/",
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5178,
    strictPort: false,
  },
});
