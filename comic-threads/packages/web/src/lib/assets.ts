/**
 * Static asset URLs. `assets/` is Vite's `publicDir` (see vite.config.ts), so
 * the same paths resolve in dev and in a production build, and honour a
 * non-root deploy base (GitHub Pages) via `import.meta.env.BASE_URL`.
 */

const BASE: string = import.meta.env.BASE_URL || "/";

export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, "");
  return BASE.endsWith("/") ? BASE + clean : `${BASE}/${clean}`;
}

export function characterDirUrl(name: string): string {
  return assetUrl(`characters/${name}`);
}

export function characterIconUrl(name: string, iconImage = "icon.png"): string {
  return `${characterDirUrl(name)}/${iconImage}`;
}
