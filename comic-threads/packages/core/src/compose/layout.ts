/**
 * Avatar layout — a port of panel.cpp LayoutAvatars (l.525) + OrderAvatars +
 * UpdateHistoresis. Only speakers (and invited silent listeners) are drawn.
 * Heights are normalised so the tallest body ≤ unitHeight/1.9; the row is
 * shrunk to fit or zoomed in (capped so heads aren't cropped, headFactor·1.2);
 * margins are even; characters keep their left/right slot across panels
 * (position hysteresis) and face inward (leftmost faces right, rightmost left).
 */

import type { PoseSelection } from "../characters.js";
import type { EmotionName } from "../emotion/wheel.js";
import type { Rng } from "../rng.js";
import {
  MAX_BODY_HEIGHT,
  UNIT_HEIGHT,
  UNIT_WIDTH,
  type PlacedBody,
  type PlacedImage,
} from "./types.js";

export interface CastMember {
  login: string;
  character: string;
  emotion: EmotionName;
  pose: PoseSelection;
  silent: boolean;
}

/** Head fraction of a body used for the zoom-in head-cropping guard. */
const HEAD_FRACTION = 0.42;

export interface LayoutContext {
  /** login -> slot index in the previous panel (position hysteresis). */
  previousSlots: Map<string, number>;
  /** establishing panels never zoom in (keep the wide shot). */
  establishing: boolean;
}

/**
 * Order avatars honouring hysteresis: members seen in the previous panel keep
 * their relative left→right order; newcomers are appended in arrival order.
 */
function orderAvatars(cast: CastMember[], previousSlots: Map<string, number>): CastMember[] {
  return cast
    .map((m, i) => ({ m, i, prev: previousSlots.get(m.login) }))
    .sort((a, b) => {
      const pa = a.prev ?? Number.POSITIVE_INFINITY;
      const pb = b.prev ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return a.i - b.i; // stable arrival order for newcomers/ties
    })
    .map((e) => e.m);
}

export interface LaidOutRow {
  bodies: PlacedBody[];
  /** login -> slot index, to seed the next panel's hysteresis. */
  slots: Map<string, number>;
}

export function layoutAvatars(
  cast: CastMember[],
  ctx: LayoutContext,
  _rng: Rng,
): LaidOutRow {
  const ordered = orderAvatars(cast, ctx.previousSlots);
  const n = ordered.length;
  if (n === 0) return { bodies: [], slots: new Map() };

  const origW = ordered.map((m) => Math.max(1, m.pose.w));
  const origH = ordered.map((m) => Math.max(1, m.pose.h));
  const maxNorm = Math.max(...origH);

  // Normalise so the tallest body maps to MAX_BODY_HEIGHT.
  const normScale = ordered.map((_, i) => (MAX_BODY_HEIGHT * (origH[i]! / maxNorm)) / origH[i]!);
  let width = ordered.map((_, i) => origW[i]! * normScale[i]!);
  let height = ordered.map((_, i) => origH[i]! * normScale[i]!);
  const headHeight = height.map((h) => h * HEAD_FRACTION);

  let sumWidth = width.reduce((a, b) => a + b, 0);
  let scale = normScale.slice();

  const zoomIn = n <= 3;

  if (sumWidth > UNIT_WIDTH) {
    const reduction = UNIT_WIDTH / sumWidth;
    for (let i = 0; i < n; i++) {
      width[i]! *= reduction;
      height[i]! *= reduction;
      scale[i]! *= reduction;
    }
  } else if (zoomIn && !ctx.establishing) {
    let zoom = UNIT_WIDTH / sumWidth;
    const maxHead = Math.max(...headHeight);
    const headFactor = MAX_BODY_HEIGHT / (maxHead * 1.2); // don't cut at the neck
    zoom = Math.min(zoom, headFactor);
    if (zoom < 1.1) zoom = 1.0;
    for (let i = 0; i < n; i++) {
      width[i]! *= zoom;
      height[i]! *= zoom;
      scale[i]! *= zoom;
    }
  }

  const totalWidth = width.reduce((a, b) => a + b, 0);
  const margin = (UNIT_WIDTH - totalWidth) / (n + 1);

  const bodies: PlacedBody[] = [];
  const slots = new Map<string, number>();
  let xOffset = margin;
  const panelCenter = UNIT_WIDTH / 2;

  for (let i = 0; i < n; i++) {
    const m = ordered[i]!;
    const w = width[i]!;
    const h = height[i]!;
    const x = xOffset;
    const y = UNIT_HEIGHT - h; // feet on the floor
    const s = scale[i]!;
    const centerX = x + w / 2;
    const flip = centerX > panelCenter && n > 1;

    const faceLocalX = m.pose.faceX * s;
    const faceLocalY = m.pose.faceY * s;
    const anchorX = flip ? x + (w - faceLocalX) : x + faceLocalX;
    const anchorY = y + faceLocalY;

    const images: PlacedImage[] = m.pose.images.map((img) => ({
      href: img.href,
      x: x + img.dx * s,
      y: y + img.dy * s,
      w: img.w * s,
      h: img.h * s,
      flip,
    }));

    bodies.push({
      login: m.login,
      character: m.character,
      emotion: m.emotion,
      x,
      y,
      w,
      h,
      images,
      flip,
      anchorX,
      anchorY,
      silent: m.silent,
    });
    slots.set(m.login, i);
    xOffset += w + margin;
  }

  return { bodies, slots };
}
