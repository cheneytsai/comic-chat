/**
 * Namespaced chrome.storage.local access. Same shape as the web app's
 * storage.ts (readJson/writeJson), but chrome.storage is inherently async and
 * isolated from the host page's own localStorage — unlike a content script's
 * localStorage, which is the *page's* storage and readable by page scripts,
 * chrome.storage.local is private to the extension. That matters here: F11
 * says a PAT is only ever sent to api.github.com, and storing it somewhere a
 * compromised github.com page script could read would quietly break that.
 */

const NS = "comic-threads";

function key(suffix: string): string {
  return `${NS}:${suffix}`;
}

export async function readJson<T>(suffix: string, fallback: T): Promise<T> {
  try {
    const result = await chrome.storage.local.get(key(suffix));
    const raw = result[key(suffix)];
    return raw === undefined ? fallback : (raw as T);
  } catch {
    return fallback;
  }
}

export async function writeJson(suffix: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key(suffix)]: value });
  } catch {
    /* quota / disabled — settings are a nicety, not a requirement */
  }
}
