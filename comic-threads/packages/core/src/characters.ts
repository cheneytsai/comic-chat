/**
 * Character manifests, casting, and pose selection — the port of bodycam.cpp /
 * avatar.cpp GetBodyFromEmotion. Manifests follow the frozen §4.3 schema.
 *
 * Casting: deterministic stable-hash of a login → a roster character, with
 * linear probing so distinct logins don't collide until the roster is
 * exhausted (then reuse). Explicit overrides win.
 *
 * Pose selection: gestures match by exact name; wheel emotions minimise the
 * Euclidean distance between polar points (r=intensity, θ=angle); neutral picks
 * among low-intensity poses with seeded variety. Complex avatars pick face and
 * torso independently and composite them with the §4.3 head-offset formula.
 */

import {
  isGesture,
  isWalk,
  isWheelEmotion,
  toCartesian,
  type EmotionName,
} from "./emotion/wheel.js";
import type { InferredEmotion } from "./emotion/engine.js";
import { hashString, type Rng } from "./rng.js";

export interface PoseRecord {
  image: string;
  w: number;
  h: number;
  emotion: EmotionName;
  intensity: number;
  /** balloon tail anchor within this pose's own bitmap. */
  faceX: number;
  faceY: number;
  // complex-avatar compositing offsets (avatar.cpp CBodyDouble::GetDimInfo)
  xCX?: number;
  yCX?: number;
  dxCX?: number;
  dyCX?: number;
}

export interface CharacterManifest {
  name: string;
  source: string;
  type: "simple" | "complex";
  iconImage: string;
  bodies?: PoseRecord[];
  faces?: PoseRecord[];
  torsos?: PoseRecord[];
  /** Base URL/path prepended to image names at render time. Set on load. */
  basePath?: string;
}

export interface Roster {
  /** Ordered list of character names available for casting. */
  names: string[];
  manifests: Map<string, CharacterManifest>;
}

export function makeRoster(manifests: CharacterManifest[]): Roster {
  const map = new Map<string, CharacterManifest>();
  for (const m of manifests) map.set(m.name, m);
  return { names: manifests.map((m) => m.name), manifests: map };
}

// --- Casting ---------------------------------------------------------------

export interface CastingOptions {
  /** login -> character name; forced assignments (viewer re-casting, "self"). */
  overrides?: Record<string, string>;
}

/**
 * Deterministically assign each login a character. Stable across runs; probes
 * forward on collision so no two logins share a character until the roster is
 * exhausted, after which characters are reused.
 */
export function castParticipants(
  logins: string[],
  roster: Roster,
  options: CastingOptions = {},
): Map<string, string> {
  const assignment = new Map<string, string>();
  const used = new Set<string>();
  const n = roster.names.length;
  if (n === 0) return assignment;

  const overrides = options.overrides ?? {};

  // Explicit overrides first (they own their slot).
  for (const login of logins) {
    const forced = overrides[login];
    if (forced && roster.manifests.has(forced)) {
      assignment.set(login, forced);
      used.add(forced);
    }
  }

  for (const login of logins) {
    if (assignment.has(login)) continue;
    const start = hashString(login) % n;
    let chosen: string | null = null;
    if (used.size < n) {
      for (let i = 0; i < n; i++) {
        const name = roster.names[(start + i) % n]!;
        if (!used.has(name)) {
          chosen = name;
          break;
        }
      }
    }
    if (chosen === null) chosen = roster.names[start]!; // roster exhausted: reuse
    assignment.set(login, chosen);
    used.add(chosen);
  }

  return assignment;
}

// --- Pose selection --------------------------------------------------------

export interface RenderImage {
  href: string;
  w: number;
  h: number;
  /** offset of this image within the pose bounding box. */
  dx: number;
  dy: number;
}

export interface PoseSelection {
  type: "simple" | "complex";
  /** images to stack, back-to-front (torso then face for complex). */
  images: RenderImage[];
  /** overall pose bounding box. */
  w: number;
  h: number;
  /** balloon tail anchor within the pose box (before any facing flip). */
  faceX: number;
  faceY: number;
  emotion: EmotionName;
}

function resolveHref(manifest: CharacterManifest, image: string): string {
  const base = manifest.basePath ?? "";
  if (!base) return image;
  return base.endsWith("/") ? base + image : `${base}/${image}`;
}

function wheelDistance(a: { emotion: EmotionName; intensity: number }, b: PoseRecord): number {
  const pa = toCartesian({ emotion: a.emotion, intensity: a.intensity });
  const pb = toCartesian({ emotion: b.emotion, intensity: b.intensity });
  const dx = pa.x - pb.x;
  const dy = pa.y - pb.y;
  return Math.hypot(dx, dy);
}

/** Pick the best matching record from a pose list for the target emotion. */
function selectRecord(
  poses: PoseRecord[],
  target: InferredEmotion,
  rng: Rng,
): PoseRecord | null {
  if (poses.length === 0) return null;
  const name = target.emotion;

  // Exact-match gestures / walks.
  if (isGesture(name) || isWalk(name)) {
    const exact = poses.filter((p) => p.emotion === name);
    if (exact.length > 0) return rng.pick(exact);
    return selectNeutral(poses, rng);
  }

  if (name === "neutral") return selectNeutral(poses, rng);

  // Wheel emotion: minimise polar Euclidean distance among wheel poses.
  const wheelPoses = poses.filter((p) => isWheelEmotion(p.emotion) || p.emotion === "neutral");
  const candidates = wheelPoses.length > 0 ? wheelPoses : poses;
  let best: PoseRecord | null = null;
  let bestD = Infinity;
  const ties: PoseRecord[] = [];
  for (const p of candidates) {
    const d = wheelDistance(target, p);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = p;
      ties.length = 0;
      ties.push(p);
    } else if (Math.abs(d - bestD) <= 1e-9) {
      ties.push(p);
    }
  }
  if (ties.length > 1) return rng.pick(ties);
  return best;
}

function selectNeutral(poses: PoseRecord[], rng: Rng): PoseRecord | null {
  if (poses.length === 0) return null;
  const lowIntensity = poses.filter((p) => p.emotion === "neutral" || p.intensity < 0.25);
  const pool = lowIntensity.length > 0 ? lowIntensity : poses;
  return rng.pick(pool);
}

/**
 * Select a renderable pose for a character given an inferred emotion.
 * For angle math, `neutral` uses angle 0 and gestures compare by name only.
 */
export function pickPose(
  manifest: CharacterManifest,
  emotion: InferredEmotion,
  rng: Rng,
): PoseSelection {
  if (manifest.type === "complex" && manifest.faces && manifest.torsos) {
    const face = selectRecord(manifest.faces, emotion, rng) ?? manifest.faces[0]!;
    // torsos are mostly neutral; select by wheel distance but tolerate misses
    const torso =
      selectRecord(manifest.torsos, emotion, rng) ?? manifest.torsos[0]!;
    // §4.3 head offset = (torso.xCX + face.dxCX − face.xCX, torso.yCX + face.dyCX − face.yCX)
    const headDx = (torso.xCX ?? 0) + (face.dxCX ?? 0) - (face.xCX ?? 0);
    const headDy = (torso.yCX ?? 0) + (face.dyCX ?? 0) - (face.yCX ?? 0);
    const w = Math.max(torso.w, headDx + face.w);
    const h = Math.max(torso.h, headDy + face.h);
    const images: RenderImage[] = [
      { href: resolveHref(manifest, torso.image), w: torso.w, h: torso.h, dx: 0, dy: 0 },
      { href: resolveHref(manifest, face.image), w: face.w, h: face.h, dx: headDx, dy: headDy },
    ];
    return {
      type: "complex",
      images,
      w,
      h,
      faceX: headDx + face.faceX,
      faceY: headDy + face.faceY,
      emotion: emotion.emotion,
    };
  }

  const bodies = manifest.bodies ?? [];
  const rec = selectRecord(bodies, emotion, rng) ?? bodies[0];
  if (!rec) {
    // No art at all: return a placeholder 1x1 box so callers never crash.
    return { type: "simple", images: [], w: 1, h: 1, faceX: 0.5, faceY: 0, emotion: emotion.emotion };
  }
  return {
    type: "simple",
    images: [{ href: resolveHref(manifest, rec.image), w: rec.w, h: rec.h, dx: 0, dy: 0 }],
    w: rec.w,
    h: rec.h,
    faceX: rec.faceX,
    faceY: rec.faceY,
    emotion: emotion.emotion,
  };
}
