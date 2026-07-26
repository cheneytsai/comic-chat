/**
 * Casting overrides (F2). Deterministic assignment lives in core
 * (`castParticipants`, stable hash of login); this module only persists the
 * viewer's explicit re-casts, keyed by repo so the same person keeps their
 * chosen character across every thread in that repo.
 */

import { readJson, writeJson } from "./storage.js";

export type CastOverrides = Record<string, string>;

/** "owner/repo" from a thread id ("owner/repo#123"), or the id itself. */
export function repoKeyFromThreadId(threadId: string): string {
  const hash = threadId.indexOf("#");
  return hash === -1 ? threadId : threadId.slice(0, hash);
}

function suffix(repoKey: string): string {
  return `cast:${repoKey}`;
}

export function loadOverrides(repoKey: string): CastOverrides {
  const raw = readJson<Record<string, unknown>>(suffix(repoKey), {});
  const out: CastOverrides = {};
  for (const [login, character] of Object.entries(raw)) {
    if (typeof character === "string" && character) out[login] = character;
  }
  return out;
}

export function saveOverrides(repoKey: string, overrides: CastOverrides): void {
  writeJson(suffix(repoKey), overrides);
}

export function setOverride(
  repoKey: string,
  current: CastOverrides,
  login: string,
  character: string | null,
): CastOverrides {
  const next: CastOverrides = { ...current };
  if (character === null) delete next[login];
  else next[login] = character;
  saveOverrides(repoKey, next);
  return next;
}
