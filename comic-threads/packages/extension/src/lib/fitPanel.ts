/**
 * A geometry fix-up pass applied between `composeThread` and `renderPanelSVG`.
 * Both problems it solves are in the layout maths, not in the drawing, so it
 * works on composed `Panel` data and leaves the renderer alone.
 *
 * 1. **Zoomed figures hide behind their own balloons.** `layoutAvatars` zooms
 *    panels holding ≤3 characters by up to `MAX_BODY_HEIGHT / (head · 1.2)`,
 *    which for typical art is ~2× — a 794-unit-tall figure in a 760-unit panel.
 *    Feet stay on the floor, so the head rides up into the balloon zone and the
 *    balloons paint straight over the face the tail is pointing at. Here the
 *    panel's figures are scaled down (uniformly, so their relative heights
 *    survive) until each one's head clears the balloons above it, then re-spaced
 *    with even margins the way `layoutAvatars` does.
 *
 * 2. **The last balloon in a crowded panel escapes the frame.**
 *    `layoutBalloons` clamps a balloon's x into the panel and then re-applies
 *    the packing cursor (`if (x < cursor) x = cursor`), which wins — so once the
 *    earlier balloons in a 4-or-5-balloon panel have eaten the width, the last
 *    one is pushed past the right edge and the SVG viewport clips its text.
 *    A crowded panel is authentic; a sentence sliced off by the frame is not,
 *    so the balloon is pulled back inside and allowed to overlap its neighbour.
 *
 * Both belong in `@comic-threads/core` eventually — see the hand-off notes.
 * They are written as pure `Panel → Panel` transforms so moving them is a copy.
 */

import {
  UNIT_HEIGHT,
  UNIT_WIDTH,
  type Panel,
  type PlacedBalloon,
  type PlacedBody,
} from "@comic-threads/core";

/**
 * Keep the cloud's scallops inside the frame: `cloudPath` arcs outward by up to
 * ~25 units beyond the balloon box on every edge.
 */
const EDGE_PAD = 26;
/**
 * `spikyPath` inscribes its star in an ellipse inside the balloon box, but the
 * text is laid out to fill the box's *rectangle* — so the corners of a shout
 * always poke through the outline. Inflating the box about its centre pulls the
 * text back inside the star. The renderer positions text relative to the box
 * top, but a balloon's ink sits half a line off its centre either way, so a
 * symmetric inflation leaves the text where it was and only grows the star.
 * Full containment would need ~1.25×; that much extra width starts covering the
 * neighbouring balloon in a crowded panel, so this stops where the star reads as
 * the balloon and only the odd capital grazes the outline.
 */
const SHOUT_INFLATE = 1.1;
/** Balloons may cover this much of a figure's top — shoulders, not the face. */
const HEAD_CLEARANCE = 54;
/** Never shrink a panel's cast below this, however tall the balloons are. */
const MIN_BODY_HEIGHT = 280;

/** Breathing room between two balloons' boxes (their scallops still touch). */
const BALLOON_GAP = 14;

/** Grow shout stars; everything else keeps its size. Position is repacked next. */
function inflateShout(balloon: PlacedBalloon): PlacedBalloon {
  if (balloon.kind !== "shout") return balloon;
  const w = balloon.w * SHOUT_INFLATE;
  const h = balloon.h * SHOUT_INFLATE;
  return {
    ...balloon,
    w,
    h,
    x: balloon.x - (w - balloon.w) / 2,
    y: Math.max(EDGE_PAD * 0.5, balloon.y - (h - balloon.h) / 2),
  };
}

/**
 * Place the row of balloons inside the frame without letting them cover each
 * other's words. Left-to-right order (which `layoutBalloons` set from speaker
 * position, so tails don't cross) is preserved throughout; each balloon moves as
 * little as the constraints allow. When the row genuinely cannot fit — five
 * balloons in one panel, one of them eleven lines long — the shortfall is spread
 * evenly instead of dumped on the last balloon, which is what pushed it out of
 * the frame to be clipped.
 */
function repackBalloons(balloons: PlacedBalloon[]): PlacedBalloon[] {
  const order = balloons
    .map((_balloon, i) => i)
    .filter((i) => balloons[i]!.kind !== "caption")
    .sort((a, b) => balloons[a]!.x - balloons[b]!.x);
  if (order.length === 0) return balloons;

  const left = EDGE_PAD;
  const right = UNIT_WIDTH - EDGE_PAD;
  const widths = order.map((i) => balloons[i]!.w);
  const xs = order.map((i) => balloons[i]!.x);
  const needed = widths.reduce((a, b) => a + b, 0) + BALLOON_GAP * (order.length - 1);

  if (needed <= right - left) {
    let cursor = left;
    for (let k = 0; k < order.length; k++) {
      xs[k] = Math.max(xs[k]!, cursor);
      cursor = xs[k]! + widths[k]! + BALLOON_GAP;
    }
    let limit = right;
    for (let k = order.length - 1; k >= 0; k--) {
      xs[k] = Math.max(left, Math.min(xs[k]!, limit - widths[k]!));
      limit = xs[k]! - BALLOON_GAP;
    }
  } else {
    const crowding = (needed - (right - left)) / Math.max(1, order.length - 1);
    let cursor = left;
    for (let k = 0; k < order.length; k++) {
      xs[k] = cursor;
      cursor = xs[k]! + widths[k]! + BALLOON_GAP - crowding;
    }
  }

  const out = balloons.slice();
  order.forEach((i, k) => {
    if (xs[k] !== balloons[i]!.x) out[i] = { ...balloons[i]!, x: xs[k]! };
  });
  return out;
}

interface Obstruction {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything a figure has to duck under: balloons, plus any terminal card. */
function obstructions(panel: Panel, balloons: PlacedBalloon[]): Obstruction[] {
  const out: Obstruction[] = balloons.filter((b) => b.kind !== "caption");
  if (panel.terminal) out.push(panel.terminal);
  return out;
}

/** Lowest point of whatever stands over `body`'s column. */
function ceilingOver(body: PlacedBody, above: Obstruction[]): number {
  let bottom = 0;
  for (const o of above) {
    const overlaps = o.x < body.x + body.w && o.x + o.w > body.x;
    if (overlaps) bottom = Math.max(bottom, o.y + o.h);
  }
  return bottom;
}

/** The largest uniform scale (≤1) at which every figure clears what's above it. */
function fitScale(bodies: PlacedBody[], above: Obstruction[]): number {
  let scale = 1;
  for (const body of bodies) {
    if (body.h <= 0) continue;
    const allowedTop = Math.max(0, ceilingOver(body, above) - HEAD_CLEARANCE);
    const maxHeight = UNIT_HEIGHT - allowedTop;
    if (body.h > maxHeight) {
      const needed = Math.max(maxHeight, Math.min(body.h, MIN_BODY_HEIGHT)) / body.h;
      scale = Math.min(scale, needed);
    }
  }
  return scale;
}

/** Scale the row about the panel floor and re-space it with even margins. */
function rescaleBodies(bodies: PlacedBody[], scale: number): PlacedBody[] {
  const widths = bodies.map((b) => b.w * scale);
  const total = widths.reduce((a, b) => a + b, 0);
  const margin = Math.max(0, (UNIT_WIDTH - total) / (bodies.length + 1));

  let cursor = margin;
  return bodies.map((body, i) => {
    const w = widths[i]!;
    const h = body.h * scale;
    const x = cursor;
    const y = UNIT_HEIGHT - h;
    cursor += w + margin;
    return {
      ...body,
      x,
      y,
      w,
      h,
      images: body.images.map((img) => ({
        ...img,
        x: x + (img.x - body.x) * scale,
        y: y + (img.y - body.y) * scale,
        w: img.w * scale,
        h: img.h * scale,
      })),
      anchorX: x + (body.anchorX - body.x) * scale,
      anchorY: y + (body.anchorY - body.y) * scale,
    };
  });
}

/** Re-point every tail at its speaker's moved anchor. */
function retarget(balloons: PlacedBalloon[], bodies: PlacedBody[]): PlacedBalloon[] {
  const anchors = new Map(bodies.map((b) => [b.login, { x: b.anchorX, y: b.anchorY }]));
  return balloons.map((balloon) => {
    if (!balloon.speakerLogin || balloon.tailX === undefined) return balloon;
    const anchor = anchors.get(balloon.speakerLogin);
    if (!anchor) return balloon;
    return { ...balloon, tailX: anchor.x, tailY: anchor.y };
  });
}

export function fitPanel(panel: Panel): Panel {
  const balloons = repackBalloons(panel.balloons.map(inflateShout));
  const clamped = balloons.some((b, i) => b !== panel.balloons[i]);

  if (panel.bodies.length === 0) {
    return clamped ? { ...panel, balloons } : panel;
  }

  const scale = fitScale(panel.bodies, obstructions(panel, balloons));
  if (scale >= 0.999) {
    return clamped ? { ...panel, balloons } : panel;
  }

  const bodies = rescaleBodies(panel.bodies, scale);
  return { ...panel, bodies, balloons: retarget(balloons, bodies) };
}
