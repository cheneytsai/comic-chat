/**
 * Viewer settings (F11): an optional GitHub PAT and the polling cadence.
 * Mirrors the web app's settings.ts; see storage.ts for why this one is
 * chrome.storage-backed instead of localStorage-backed. The token is handed
 * to @comic-threads/github-source only, in the background service worker,
 * which puts it in an Authorization header on requests to api.github.com.
 */

import { readJson, writeJson } from "./storage.js";

export const MIN_POLL_MS = 10_000;
export const MAX_POLL_MS = 600_000;
export const DEFAULT_POLL_MS = 30_000;

export interface Settings {
  token: string;
  pollIntervalMs: number;
}

const DEFAULTS: Settings = {
  token: "",
  pollIntervalMs: DEFAULT_POLL_MS,
};

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(ms)));
}

export async function loadSettings(): Promise<Settings> {
  const raw = await readJson<Partial<Settings>>("settings", {});
  return {
    token: typeof raw.token === "string" ? raw.token : DEFAULTS.token,
    pollIntervalMs: clampInterval(
      typeof raw.pollIntervalMs === "number" ? raw.pollIntervalMs : DEFAULTS.pollIntervalMs,
    ),
  };
}

export async function saveSettings(next: Settings): Promise<Settings> {
  const clean: Settings = {
    token: next.token.trim(),
    pollIntervalMs: clampInterval(next.pollIntervalMs),
  };
  await writeJson("settings", clean);
  return clean;
}
