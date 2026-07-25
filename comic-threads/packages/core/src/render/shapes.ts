/**
 * Balloon geometry as SVG path data — a port of the balloon.cpp shape family:
 * speech = scalloped cloud with a polyline tail; thought = cloud with a trail
 * of shrinking bubbles; shout = spiky star-burst; whisper = dashed cloud;
 * caption = plain rectangle. All builders return path `d` strings in the
 * panel's unit space.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function pt(x: number, y: number): string {
  return `${x.toFixed(1)} ${y.toFixed(1)}`;
}

/**
 * A scalloped (bumpy) closed cloud path around `box`. `bump` sets the scallop
 * radius; larger = puffier. Bumps arc OUTWARD on every edge.
 */
export function cloudPath(box: Box, bump = 26): string {
  const { x, y, w, h } = box;
  const segs = (len: number) => Math.max(2, Math.round(len / (bump * 1.6)));
  const parts: string[] = [];
  parts.push(`M ${pt(x, y)}`);

  const edge = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    sweep: 0 | 1,
  ): void => {
    const n = segs(Math.hypot(x2 - x1, y2 - y1));
    const r = Math.hypot(x2 - x1, y2 - y1) / (2 * n);
    for (let i = 1; i <= n; i++) {
      const px = x1 + ((x2 - x1) * i) / n;
      const py = y1 + ((y2 - y1) * i) / n;
      parts.push(`A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${sweep} ${pt(px, py)}`);
    }
  };

  edge(x, y, x + w, y, 1); // top, bulge up
  edge(x + w, y, x + w, y + h, 1); // right, bulge right
  edge(x + w, y + h, x, y + h, 1); // bottom, bulge down
  edge(x, y + h, x, y, 1); // left, bulge left
  parts.push("Z");
  return parts.join(" ");
}

/** Rounded rectangle path (for whisper / caption fallbacks). */
export function roundedRectPath(box: Box, r = 18): string {
  const { x, y, w, h } = box;
  const rr = Math.min(r, w / 2, h / 2);
  return [
    `M ${pt(x + rr, y)}`,
    `H ${(x + w - rr).toFixed(1)}`,
    `A ${rr} ${rr} 0 0 1 ${pt(x + w, y + rr)}`,
    `V ${(y + h - rr).toFixed(1)}`,
    `A ${rr} ${rr} 0 0 1 ${pt(x + w - rr, y + h)}`,
    `H ${(x + rr).toFixed(1)}`,
    `A ${rr} ${rr} 0 0 1 ${pt(x, y + h - rr)}`,
    `V ${(y + rr).toFixed(1)}`,
    `A ${rr} ${rr} 0 0 1 ${pt(x + rr, y)}`,
    "Z",
  ].join(" ");
}

/** Spiky star-burst outline around `box` (shout balloon). */
export function spikyPath(box: Box, spikes = 22): string {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2;
  const ry = box.h / 2;
  const parts: string[] = [];
  const total = spikes * 2;
  for (let i = 0; i < total; i++) {
    const ang = (i / total) * Math.PI * 2 - Math.PI / 2;
    const out = i % 2 === 0 ? 1.0 : 0.78;
    const px = cx + Math.cos(ang) * rx * out;
    const py = cy + Math.sin(ang) * ry * out;
    parts.push(`${i === 0 ? "M" : "L"} ${pt(px, py)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** Triangular tail from a balloon's bottom edge to the speaker anchor. */
export function tailPath(box: Box, tailX: number, tailY: number): string {
  const baseY = box.y + box.h - 4;
  const baseCenter = Math.max(box.x + 24, Math.min(tailX, box.x + box.w - 24));
  const half = 16;
  return [
    `M ${pt(baseCenter - half, baseY)}`,
    `L ${pt(tailX, tailY)}`,
    `L ${pt(baseCenter + half, baseY)}`,
    "Z",
  ].join(" ");
}

/** Trail of shrinking bubbles from a thought balloon toward the speaker. */
export function thoughtTrail(box: Box, tailX: number, tailY: number): Box[] {
  const baseX = Math.max(box.x + 24, Math.min(tailX, box.x + box.w - 24));
  const baseY = box.y + box.h;
  const bubbles: Box[] = [];
  const steps = 3;
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const r = 16 * (1 - t) + 5;
    const bx = baseX + (tailX - baseX) * t;
    const by = baseY + (tailY - baseY) * t;
    bubbles.push({ x: bx - r, y: by - r, w: r * 2, h: r * 2 });
  }
  return bubbles;
}
