/**
 * Roster loading. `assets/fixtures/roster.json` is a light index of the 22
 * extracted characters (name, kind, icon, pose counts) — a few KB. The full
 * manifest for a character (up to ~30 pose records) is fetched lazily, and only
 * for characters that are actually cast in the thread being rendered, so the
 * initial payload stays small no matter how big the roster grows.
 */

import { makeRoster, type CharacterManifest, type Roster } from "@comic-threads/core";
import { assetUrl, characterDirUrl } from "./assets.js";

export interface RosterCharacter {
  name: string;
  type: "simple" | "complex";
  iconImage: string;
  poseCount: number;
  faceCount: number;
  torsoCount: number;
  bodyCount: number;
  emotions: string[];
}

export interface RosterIndex {
  version: number;
  basePath: string;
  characters: RosterCharacter[];
}

let indexPromise: Promise<RosterIndex> | null = null;
const manifestCache = new Map<string, Promise<CharacterManifest>>();

export function loadRosterIndex(): Promise<RosterIndex> {
  if (!indexPromise) {
    indexPromise = fetch(assetUrl("fixtures/roster.json"))
      .then((res) => {
        if (!res.ok) throw new Error(`roster.json: HTTP ${res.status}`);
        return res.json() as Promise<RosterIndex>;
      })
      .catch((err: unknown) => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

/**
 * Complex avatars composite a face over a torso at
 * `headDy = torso.yCX + face.dyCX − face.yCX` (DESIGN.md §4.3), and in the real
 * extracted art that offset is **negative** — the head sits 70–200 units ABOVE
 * the torso bitmap's top edge, which is where a head belongs. `pickPose` sizes
 * the pose box as `max(torso.h, headDy + face.h)`, so with a negative offset the
 * box covers the torso only: layout then normalises the figure by its
 * headless height and drops the head outside the box, up into the balloon zone,
 * where the balloons paint over it.
 *
 * Fix, without touching core: give each torso record `lift` units of empty
 * headroom — grow its `h` and its `yCX` by the same amount. Growing `yCX` shifts
 * every head down by `lift` (making the worst `headDy` exactly 0, so the head
 * lands inside the box), and growing `h` grows the box to match. The torso
 * bitmap does not stretch: the renderer draws poses with
 * `preserveAspectRatio="xMidYMax meet"`, and since the record's width is
 * untouched the fit scale stays 1 and the art is simply bottom-aligned inside
 * the taller box — i.e. exactly the headroom we asked for.
 *
 * (The mirror-image case, `headDx < 0`, would need the same treatment on the
 * X axis, but padding both axes changes the `meet` scale, so it is left alone:
 * it only makes a figure sit up to ~60 units off-centre in its slot. The real
 * fix is for `pickPose` to normalise negative offsets itself — see the notes in
 * the hand-off; this shim is deliberately a no-op once it does.)
 */
export function padHeadroom(manifest: CharacterManifest): CharacterManifest {
  const { faces, torsos } = manifest;
  if (manifest.type !== "complex" || !faces?.length || !torsos?.length) return manifest;

  const padded = torsos.map((torso) => {
    let lift = 0;
    for (const face of faces) {
      const headDy = (torso.yCX ?? 0) + (face.dyCX ?? 0) - (face.yCX ?? 0);
      if (headDy < 0) lift = Math.max(lift, -headDy);
    }
    if (lift === 0) return torso;
    return { ...torso, yCX: (torso.yCX ?? 0) + lift, h: torso.h + lift };
  });

  return { ...manifest, torsos: padded };
}

export function loadManifest(name: string): Promise<CharacterManifest> {
  const cached = manifestCache.get(name);
  if (cached) return cached;
  const dir = characterDirUrl(name);
  const promise = fetch(`${dir}/manifest.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`manifest for ${name}: HTTP ${res.status}`);
      return res.json() as Promise<CharacterManifest>;
    })
    .then((manifest) => ({ ...padHeadroom(manifest), basePath: dir }))
    .catch((err: unknown) => {
      manifestCache.delete(name);
      throw err;
    });
  manifestCache.set(name, promise);
  return promise;
}

/**
 * A manifest with no art. Used for roster slots we have not loaded yet: it
 * keeps `Roster.names` (and therefore the casting hash) identical whether or
 * not a character's art has been fetched, so casting is stable.
 */
function stub(entry: RosterCharacter): CharacterManifest {
  return {
    name: entry.name,
    source: "",
    type: entry.type,
    iconImage: entry.iconImage,
    ...(entry.type === "simple" ? { bodies: [] } : { faces: [], torsos: [] }),
  };
}

/** Roster over every known character, using loaded manifests where available. */
export function buildRoster(
  index: RosterIndex,
  loaded: ReadonlyMap<string, CharacterManifest>,
): Roster {
  return makeRoster(index.characters.map((c) => loaded.get(c.name) ?? stub(c)));
}

/** Fetches the manifests for `names`, tolerating individual failures. */
export async function loadManifests(
  names: Iterable<string>,
): Promise<Map<string, CharacterManifest>> {
  const unique = [...new Set(names)];
  const results = await Promise.all(
    unique.map(async (name) => {
      try {
        return [name, await loadManifest(name)] as const;
      } catch {
        return null;
      }
    }),
  );
  const map = new Map<string, CharacterManifest>();
  for (const entry of results) if (entry) map.set(entry[0], entry[1]);
  return map;
}
