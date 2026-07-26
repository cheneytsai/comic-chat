/**
 * Namespaced localStorage access that never throws (private mode, quota,
 * disabled storage) and never surfaces `any` to callers.
 */

const NS = "comic-threads";

function key(suffix: string): string {
  return `${NS}:${suffix}`;
}

function store(): Storage | null {
  try {
    const s = globalThis.localStorage;
    // touch it — Safari private mode throws on access, not on use
    s.getItem(key("probe"));
    return s;
  } catch {
    return null;
  }
}

export function readJson<T>(suffix: string, fallback: T): T {
  const s = store();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key(suffix));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(suffix: string, value: unknown): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key(suffix), JSON.stringify(value));
  } catch {
    /* quota / disabled — settings are a nicety, not a requirement */
  }
}

export function removeKey(suffix: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(key(suffix));
  } catch {
    /* ignore */
  }
}
