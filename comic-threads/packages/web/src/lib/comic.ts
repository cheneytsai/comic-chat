/**
 * Thread → Comic. Casting is computed first against the (art-free) roster index
 * so it depends only on the roster's names, then just the manifests for the
 * characters actually cast are fetched before composing.
 */

import {
  castParticipants,
  composeThread,
  type CharacterManifest,
  type Comic,
  type Thread,
} from "@comic-threads/core";
import { buildRoster, loadManifests, type RosterIndex } from "./roster.js";
import { toSpokenThread } from "./speech.js";
import type { CastOverrides } from "./casting.js";

export interface ComposedComic {
  comic: Comic;
  /** login → character name, after overrides. */
  casting: Map<string, string>;
}

const manifestMemo = new Map<string, CharacterManifest>();

export function planCasting(
  thread: Thread,
  index: RosterIndex,
  overrides: CastOverrides,
): Map<string, string> {
  const roster = buildRoster(index, manifestMemo);
  return castParticipants(
    thread.participants.map((p) => p.login),
    roster,
    { overrides },
  );
}

export async function composeComic(
  thread: Thread,
  index: RosterIndex,
  overrides: CastOverrides,
): Promise<ComposedComic> {
  const casting = planCasting(thread, index, overrides);
  const fetched = await loadManifests(casting.values());
  for (const [name, manifest] of fetched) manifestMemo.set(name, manifest);

  const roster = buildRoster(index, manifestMemo);
  const comic = composeThread(toSpokenThread(thread), { roster, casting });
  return { comic, casting };
}
