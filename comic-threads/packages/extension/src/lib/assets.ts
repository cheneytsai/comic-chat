/**
 * Static asset URLs. The web app serves `assets/` as Vite's publicDir; an
 * extension instead ships them inside the package and resolves them through
 * chrome.runtime.getURL, declared as web_accessible_resources in manifest.json
 * (see build/copy-assets.mjs, which copies assets/characters + roster.json
 * into dist/assets/ at build time).
 */

export function assetUrl(path: string): string {
  return chrome.runtime.getURL(`assets/${path.replace(/^\/+/, "")}`);
}

export function characterDirUrl(name: string): string {
  return assetUrl(`characters/${name}`);
}

export function characterIconUrl(name: string, iconImage = "icon.png"): string {
  return `${characterDirUrl(name)}/${iconImage}`;
}
