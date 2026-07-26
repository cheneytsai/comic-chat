/**
 * Casting overrides (F2), mirrored from the web app — same key scheme
 * ("cast:<owner>/<repo>"), so a viewer who uses both sees the same cast.
 * Deterministic assignment lives in core (castParticipants); this only
 * persists explicit re-casts.
 */

import { readJson, writeJson } from "./storage.js";

export type CastOverrides = Record<string, string>;

export function repoKeyFromThreadId(threadId: string): string {
  const hash = threadId.indexOf("#");
  return hash === -1 ? threadId : threadId.slice(0, hash);
}

function suffix(repoKey: string): string {
  return `cast:${repoKey}`;
}

export async function loadOverrides(repoKey: string): Promise<CastOverrides> {
  const raw = await readJson<Record<string, unknown>>(suffix(repoKey), {});
  const out: CastOverrides = {};
  for (const [login, character] of Object.entries(raw)) {
    if (typeof character === "string" && character) out[login] = character;
  }
  return out;
}

export async function setOverride(
  repoKey: string,
  current: CastOverrides,
  login: string,
  character: string | null,
): Promise<CastOverrides> {
  const next: CastOverrides = { ...current };
  if (character === null) delete next[login];
  else next[login] = character;
  await writeJson(suffix(repoKey), next);
  return next;
}
