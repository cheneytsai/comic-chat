/**
 * Viewer settings (F11): an optional GitHub PAT and the polling cadence.
 *
 * The token lives in localStorage and is handed to `@comic-threads/github-source`
 * only, which puts it in an `Authorization` header on requests to `API_BASE`
 * (https://api.github.com). Nothing in this app posts it anywhere else — there
 * is no backend, no analytics, and no third-party script.
 */

import { readJson, writeJson } from "./storage.js";

export const MIN_POLL_MS = 10_000;
export const MAX_POLL_MS = 600_000;
export const DEFAULT_POLL_MS = 30_000;

export interface Settings {
  /** GitHub personal access token; only ever sent to api.github.com. */
  token: string;
  pollIntervalMs: number;
  autoScroll: boolean;
}

const DEFAULTS: Settings = {
  token: "",
  pollIntervalMs: DEFAULT_POLL_MS,
  autoScroll: true,
};

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(ms)));
}

export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>("settings", {});
  return {
    token: typeof raw.token === "string" ? raw.token : DEFAULTS.token,
    pollIntervalMs: clampInterval(
      typeof raw.pollIntervalMs === "number" ? raw.pollIntervalMs : DEFAULTS.pollIntervalMs,
    ),
    autoScroll: typeof raw.autoScroll === "boolean" ? raw.autoScroll : DEFAULTS.autoScroll,
  };
}

export function saveSettings(next: Settings): Settings {
  const clean: Settings = {
    token: next.token.trim(),
    pollIntervalMs: clampInterval(next.pollIntervalMs),
    autoScroll: next.autoScroll,
  };
  writeJson("settings", clean);
  return clean;
}
