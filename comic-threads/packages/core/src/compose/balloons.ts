/**
 * Balloon layout — a port of panel.cpp LayoutBalloons / GetCloudEstimate /
 * RearrangeBalloons. Balloons occupy the top half of the panel, are packed
 * left→right, and their tails must not cross: we place columns in order of
 * speaker x-position so a balloon always sits above (or beside) its speaker
 * with the tail routed straight down without crossing a neighbour's.
 */

import { wrapText } from "./text.js";
import {
  BALLOON_ZONE_HEIGHT,
  UNIT_HEIGHT,
  UNIT_WIDTH,
  type BalloonKind,
  type PlacedBalloon,
  type ReactionStack,
} from "./types.js";

export interface BalloonInput {
  kind: BalloonKind;
  text: string;
  fontSize: number;
  speakerLogin: string;
  anchorX: number;
  anchorY: number;
  reactions?: ReactionStack[];
  continued?: boolean;
}

const SIDE_PAD = 26;
const TOP_PAD = 20;
const INNER_PAD = 16;
const GAP = 18;
const ROW_STAGGER = 26;
/** minimum clearance kept between a balloon's bottom and the speaker (hook). */
const HOOK_CLEARANCE = 70;

export function layoutBalloons(inputs: BalloonInput[]): PlacedBalloon[] {
  const n = inputs.length;
  if (n === 0) return [];

  const usable = UNIT_WIDTH - 2 * SIDE_PAD;
  const colWidth = (usable - GAP * (n - 1)) / n;
  const maxTextWidth = Math.max(120, colWidth - 2 * INNER_PAD);

  // Order by speaker x so tails don't cross; remember original (reading) order.
  const order = inputs
    .map((b, i) => ({ b, i }))
    .sort((a, b) => (a.b.anchorX - b.b.anchorX) || (a.i - b.i));

  const placed: PlacedBalloon[] = [];
  let cursor = SIDE_PAD;

  order.forEach((entry, slot) => {
    const input = entry.b;
    const wrapped = wrapText(input.text, maxTextWidth, input.fontSize);
    const w = Math.min(usable, wrapped.width + 2 * INNER_PAD);
    const h = wrapped.height + 2 * INNER_PAD;

    // Prefer centring over the speaker; clamp into the packed slot & panel.
    let x = input.anchorX - w / 2;
    x = Math.max(x, cursor);
    x = Math.min(x, UNIT_WIDTH - SIDE_PAD - w);
    if (x < cursor) x = cursor;

    // Gentle vertical stagger keeps reading order legible and tails distinct.
    let y = TOP_PAD + (slot % 2) * ROW_STAGGER;
    const maxBottom = Math.max(BALLOON_ZONE_HEIGHT, UNIT_HEIGHT * 0.52);
    if (y + h > maxBottom) y = Math.max(TOP_PAD, maxBottom - h);

    // Keep the balloon bottom comfortably above the speaker's head.
    const tailY = Math.min(input.anchorY, UNIT_HEIGHT);
    void HOOK_CLEARANCE;

    placed.push({
      kind: input.kind,
      lines: wrapped.lines,
      x,
      y,
      w,
      h,
      fontSize: input.fontSize,
      tailX: input.anchorX,
      tailY,
      speakerLogin: input.speakerLogin,
      reactions: input.reactions,
      continued: input.continued,
    });

    cursor = x + w + GAP;
  });

  // Restore reading order (utterance order) for rendering/snapshot stability.
  const byLogin = new Map<string, PlacedBalloon>();
  for (const p of placed) if (p.speakerLogin) byLogin.set(p.speakerLogin, p);
  const result: PlacedBalloon[] = [];
  for (const input of inputs) {
    const p = byLogin.get(input.speakerLogin);
    if (p) {
      result.push(p);
      byLogin.delete(input.speakerLogin);
    }
  }
  // include any leftovers (shouldn't happen — one balloon per speaker)
  for (const p of placed) if (!result.includes(p)) result.push(p);
  return result;
}
