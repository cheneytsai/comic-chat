// Copies everything the built extension needs into dist/ alongside the two
// vite-built bundles (content.js, background.js): the manifest, icons, and
// the character art + roster index declared as web_accessible_resources.
import { cpSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const dist = path.join(pkgRoot, "dist");

mkdirSync(dist, { recursive: true });

copyFileSync(path.join(pkgRoot, "manifest.json"), path.join(dist, "manifest.json"));
for (const size of [16, 48, 128]) {
  copyFileSync(
    path.join(pkgRoot, "icons", `icon-${size}.png`),
    path.join(dist, `icon-${size}.png`),
  );
}

mkdirSync(path.join(dist, "assets", "fixtures"), { recursive: true });
cpSync(
  path.join(repoRoot, "assets", "characters"),
  path.join(dist, "assets", "characters"),
  { recursive: true },
);
copyFileSync(
  path.join(repoRoot, "assets", "fixtures", "roster.json"),
  path.join(dist, "assets", "fixtures", "roster.json"),
);

console.log("copied manifest, icons, and character art into dist/");
