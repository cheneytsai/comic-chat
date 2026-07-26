/**
 * SVG renderer — a pure function from composed panels to SVG strings. No DOM is
 * touched here (the web package mounts the strings). Balloon shapes follow
 * balloon.cpp; characters are <image> elements (mirrored via transform when
 * facing left; complex avatars stack two images); panels are white with a 2px
 * black border.
 */

import { wrapText } from "../compose/text.js";
import {
  CAPTION_FONT_SIZE,
  TERMINAL_FONT_SIZE,
  UNIT_HEIGHT,
  UNIT_WIDTH,
  type Comic,
  type Panel,
  type PlacedBalloon,
  type PlacedBody,
  type TerminalCard,
} from "../compose/types.js";
import {
  cloudPath,
  roundedRectPath,
  spikyPath,
  tailPath,
  thoughtTrail,
  type Box,
} from "./shapes.js";

export const FONT_STACK = `"Comic Neue","Comic Sans MS","Chalkboard SE",cursive`;
export const MONO_STACK = `"JetBrains Mono","SFMono-Regular",Consolas,monospace`;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBody(body: PlacedBody): string {
  const cx = body.x + body.w / 2;
  const groupTransform = body.flip ? `transform="translate(${(2 * cx).toFixed(1)} 0) scale(-1 1)"` : "";
  const opacity = body.silent ? 0.96 : 1;
  const imgs = body.images
    .map(
      (img) =>
        `<image href="${escapeXml(img.href)}" x="${img.x.toFixed(1)}" y="${img.y.toFixed(
          1,
        )}" width="${img.w.toFixed(1)}" height="${img.h.toFixed(1)}" preserveAspectRatio="xMidYMax meet" />`,
    )
    .join("");
  // Soft contact shadow so figures sit on the floor.
  const shadow = `<ellipse cx="${cx.toFixed(1)}" cy="${(body.y + body.h - 4).toFixed(1)}" rx="${(
    body.w * 0.42
  ).toFixed(1)}" ry="10" fill="rgba(0,0,0,0.14)" />`;
  return `${shadow}<g ${groupTransform} opacity="${opacity}">${imgs}</g>`;
}

function balloonText(balloon: PlacedBalloon): string {
  const lh = Math.round(balloon.fontSize * 1.28);
  const cx = balloon.x + balloon.w / 2;
  const startY = balloon.y + 20 + balloon.fontSize * 0.5;
  const italic = balloon.kind === "whisper" ? ' font-style="italic"' : "";
  const weight = balloon.kind === "shout" ? ' font-weight="700"' : "";
  const lines = balloon.lines
    .map(
      (line, i) =>
        `<tspan x="${cx.toFixed(1)}" y="${(startY + i * lh).toFixed(1)}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<text text-anchor="middle" font-family=${JSON.stringify(FONT_STACK)} font-size="${
    balloon.fontSize
  }"${italic}${weight} fill="#111">${lines}</text>`;
}

function renderReactions(balloon: PlacedBalloon, terminal?: TerminalCard): string {
  if (!balloon.reactions || balloon.reactions.length === 0) return "";
  const x = balloon.x + 6;
  const defaultPillH = 26;
  let y = balloon.y + balloon.h + 4;
  let pillH = defaultPillH;
  let fontSize = 16;

  if (terminal) {
    const rowWidth = balloon.reactions.reduce(
      (w, r) => w + 30 + `${r.emoji} ${r.count}`.length * 11 + 6,
      0,
    );
    const overlapsX = x + rowWidth >= terminal.x - 6 && x <= terminal.x + terminal.w + 6;
    // Same reasoning as clipTailForTerminal: the default spot (just under the
    // balloon) can land on top of the terminal card's text when the two are
    // vertically adjacent. Hug the card's top edge when there's room for a
    // full-size badge; when the balloon (esp. a spiky shout box, which draws
    // outside its own nominal bounds) is close enough to the card that even
    // that would clash, shrink to fit the gap; if there is no usable gap at
    // all, drop the badges rather than smear them across whichever neighbor
    // is closest — a missing reaction count is a smaller defect than an
    // unreadable one.
    if (overlapsX && y + pillH > terminal.y) {
      const clearance = terminal.y - y;
      if (clearance >= pillH + 8) {
        y = terminal.y - pillH - 6;
      } else if (clearance >= 20) {
        pillH = clearance - 6;
        fontSize = Math.max(11, Math.round((pillH / defaultPillH) * 16));
        y = terminal.y - pillH - 4;
      } else {
        return "";
      }
    }
  }

  let px = x;
  const pills = balloon.reactions
    .map((r) => {
      const label = `${r.emoji} ${r.count}`;
      const w = 30 + label.length * 11;
      const pill = `<g><rect x="${px.toFixed(1)}" y="${y.toFixed(
        1,
      )}" rx="${(pillH / 2).toFixed(1)}" ry="${(pillH / 2).toFixed(
        1,
      )}" width="${w}" height="${pillH.toFixed(1)}" fill="#fff" stroke="#111" stroke-width="1.5"/><text x="${(
        px +
        w / 2
      ).toFixed(1)}" y="${(y + pillH / 2 + fontSize * 0.35).toFixed(
        1,
      )}" text-anchor="middle" font-family=${JSON.stringify(
        FONT_STACK,
      )} font-size="${fontSize}" fill="#111">${escapeXml(label)}</text></g>`;
      px += w + 6;
      return pill;
    })
    .join("");
  return pills;
}

/**
 * A tail routes straight from the balloon to its speaker's anchor point, with
 * no awareness of what else sits in between. When a terminal card (F6) is
 * anchored between the balloon zone and the body zone, a speaker positioned
 * behind the card gets a tail that cuts straight through the card's text —
 * so pull the endpoint up to the card's top edge whenever the straight line
 * would otherwise have to cross it.
 */
function clipTailForTerminal(
  tailX: number,
  tailY: number,
  terminal: TerminalCard | undefined,
): { x: number; y: number } {
  if (!terminal) return { x: tailX, y: tailY };
  const pad = 10;
  const crossesTerminalBand = tailX >= terminal.x - pad && tailX <= terminal.x + terminal.w + pad;
  if (crossesTerminalBand && tailY > terminal.y) {
    return { x: tailX, y: terminal.y - 6 };
  }
  return { x: tailX, y: tailY };
}

function renderBalloon(balloon: PlacedBalloon, terminal?: TerminalCard): string {
  const box: Box = { x: balloon.x, y: balloon.y, w: balloon.w, h: balloon.h };
  const hasTail = balloon.tailX !== undefined && balloon.tailY !== undefined && balloon.kind !== "caption";
  const stroke = balloon.kind === "whisper" ? 2.5 : 3;
  const dash = balloon.kind === "whisper" ? ' stroke-dasharray="10 8"' : "";

  let tail = "";
  let bubbleTrail = "";
  if (hasTail) {
    const clipped = clipTailForTerminal(balloon.tailX!, balloon.tailY!, terminal);
    if (balloon.kind === "thought") {
      bubbleTrail = thoughtTrail(box, clipped.x, clipped.y)
        .map(
          (b) =>
            `<circle cx="${(b.x + b.w / 2).toFixed(1)}" cy="${(b.y + b.h / 2).toFixed(1)}" r="${(
              b.w / 2
            ).toFixed(1)}" fill="#fff" stroke="#111" stroke-width="2.5"/>`,
        )
        .join("");
    } else {
      tail = `<path d="${tailPath(box, clipped.x, clipped.y)}" fill="#fff" stroke="#111" stroke-width="${stroke}" stroke-linejoin="round"/>`;
    }
  }

  let shapePath: string;
  if (balloon.kind === "shout") shapePath = spikyPath(box);
  else if (balloon.kind === "whisper") shapePath = roundedRectPath(box, 20);
  else shapePath = cloudPath(box, balloon.kind === "thought" ? 20 : 26);

  // Tail drawn first (behind the cloud), then cloud covers the base seam.
  const cloud = `<path d="${shapePath}" fill="#fff" stroke="#111" stroke-width="${stroke}"${dash} stroke-linejoin="round"/>`;
  return `${tail}${bubbleTrail}${cloud}${balloonText(balloon)}${renderReactions(balloon, terminal)}`;
}

function renderTerminal(card: TerminalCard): string {
  const lh = Math.round(TERMINAL_FONT_SIZE * 1.35);
  const headerH = 34;
  const bodyLines = card.lines.map(
    (line, i) =>
      `<text x="${(card.x + 16).toFixed(1)}" y="${(card.y + headerH + 24 + i * lh).toFixed(
        1,
      )}" font-family=${JSON.stringify(MONO_STACK)} font-size="${TERMINAL_FONT_SIZE}" fill="#d7e0ff">${escapeXml(
        line,
      )}</text>`,
  );
  if (card.truncated) {
    bodyLines.push(
      `<text x="${(card.x + 16).toFixed(1)}" y="${(
        card.y +
        headerH +
        24 +
        card.lines.length * lh
      ).toFixed(1)}" font-family=${JSON.stringify(MONO_STACK)} font-size="${TERMINAL_FONT_SIZE}" fill="#8890b5">… (more on GitHub)</text>`,
    );
  }
  const dots = ["#ff5f56", "#ffbd2e", "#27c93f"]
    .map((c, i) => `<circle cx="${(card.x + 18 + i * 20).toFixed(1)}" cy="${(card.y + 17).toFixed(1)}" r="6" fill="${c}"/>`)
    .join("");
  const lang = card.lang
    ? `<text x="${(card.x + card.w - 12).toFixed(1)}" y="${(card.y + 22).toFixed(
        1,
      )}" text-anchor="end" font-family=${JSON.stringify(MONO_STACK)} font-size="16" fill="#8890b5">${escapeXml(
        card.lang,
      )}</text>`
    : "";
  return [
    `<g>`,
    `<rect x="${card.x.toFixed(1)}" y="${card.y.toFixed(1)}" width="${card.w.toFixed(1)}" height="${card.h.toFixed(
      1,
    )}" rx="12" fill="#12131f" stroke="#111" stroke-width="3"/>`,
    `<path d="M ${card.x.toFixed(1)} ${(card.y + headerH).toFixed(1)} h ${card.w.toFixed(1)}" stroke="#2a2c42" stroke-width="2"/>`,
    dots,
    lang,
    ...bodyLines,
    `</g>`,
  ].join("");
}

function renderStars(panel: Panel): string {
  if (!panel.decorations.includes("stars")) return "";
  const stars: string[] = [];
  const positions = [
    [120, 120, 34],
    [860, 90, 40],
    [500, 70, 28],
    [250, 220, 22],
    [760, 240, 26],
    [420, 180, 20],
  ];
  for (const [cx, cy, r] of positions) {
    stars.push(starPolygon(cx!, cy!, r!, "#ffd23f", "#111"));
  }
  return stars.join("");
}

function starPolygon(cx: number, cy: number, r: number, fill: string, stroke: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + Math.cos(ang) * rr).toFixed(1)},${(cy + Math.sin(ang) * rr).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`;
}

function renderCaption(panel: Panel): string {
  if (!panel.caption) return "";
  const hasBodies = panel.bodies.length > 0;
  const fontSize = CAPTION_FONT_SIZE;
  const boxW = UNIT_WIDTH - 80;
  const wrapped = wrapText(panel.caption, boxW - 40, fontSize);
  const boxH = wrapped.height + 32;
  const x = 40;
  const y = hasBodies ? 30 : Math.max(30, (UNIT_HEIGHT - boxH) / 2);
  const fill = panel.captionFlavor === "merge" ? "#fff6d6" : "#fffef2";
  const lh = wrapped.lineHeight;
  const lines = wrapped.lines
    .map(
      (line, i) =>
        `<tspan x="${(UNIT_WIDTH / 2).toFixed(1)}" y="${(y + 24 + i * lh).toFixed(1)}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return [
    `<rect x="${x}" y="${y.toFixed(1)}" width="${boxW}" height="${boxH.toFixed(
      1,
    )}" fill="${fill}" stroke="#111" stroke-width="2"/>`,
    `<text text-anchor="middle" font-family=${JSON.stringify(FONT_STACK)} font-size="${fontSize}" font-style="italic" fill="#111">${lines}</text>`,
  ].join("");
}

export interface PanelRenderOptions {
  /** include the outer white background + border (default true). */
  background?: boolean;
}

/** Render one panel to a complete standalone <svg> string. */
export function renderPanelSVG(panel: Panel, options: PanelRenderOptions = {}): string {
  const bg = options.background !== false;
  const background = bg
    ? `<rect x="1.5" y="1.5" width="${UNIT_WIDTH - 3}" height="${UNIT_HEIGHT - 3}" fill="#ffffff" stroke="#111" stroke-width="3"/>`
    : "";
  const stars = renderStars(panel);
  const bodies = panel.bodies.map(renderBody).join("");
  const terminal = panel.terminal ? renderTerminal(panel.terminal) : "";
  const balloons = panel.balloons.map((b) => renderBalloon(b, panel.terminal)).join("");
  const caption = renderCaption(panel);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNIT_WIDTH} ${UNIT_HEIGHT}" class="ct-panel" preserveAspectRatio="xMidYMid meet">`,
    background,
    stars,
    bodies,
    terminal,
    balloons,
    caption,
    `</svg>`,
  ].join("");
}

/** Render the whole comic as one SVG grid (used for snapshots / static export). */
export function renderComicSVG(comic: Comic, columns = 2): string {
  const panels = comic.panels;
  if (panels.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNIT_WIDTH} ${UNIT_HEIGHT}"></svg>`;
  }
  const cols = Math.max(1, columns);
  const rows = Math.ceil(panels.length / cols);
  const gap = 24;
  const cellW = UNIT_WIDTH;
  const cellH = UNIT_HEIGHT;
  const totalW = cols * cellW + (cols + 1) * gap;
  const totalH = rows * cellH + (rows + 1) * gap + 90;

  const items = panels
    .map((panel, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = gap + c * (cellW + gap);
      const y = 90 + gap + r * (cellH + gap);
      const inner = renderPanelSVG(panel).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
      // Nested <svg> elements are no longer clipped to their own viewport by
      // default in current browsers (that UA-stylesheet special case was
      // dropped in favor of requiring it explicitly) — without this, a
      // balloon that slightly overflows its panel bleeds into the next one
      // instead of being cropped at the panel border.
      return `<svg x="${x}" y="${y}" width="${cellW}" height="${cellH}" viewBox="0 0 ${UNIT_WIDTH} ${UNIT_HEIGHT}" overflow="hidden">${inner}</svg>`;
    })
    .join("");

  const title = `<text x="${(totalW / 2).toFixed(1)}" y="56" text-anchor="middle" font-family=${JSON.stringify(
    FONT_STACK,
  )} font-size="46" font-weight="700" fill="#111">${escapeXml(comic.title)}</text>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(0)} ${totalH.toFixed(0)}">`,
    `<rect width="${totalW.toFixed(0)}" height="${totalH.toFixed(0)}" fill="#e9e4d6"/>`,
    title,
    items,
    `</svg>`,
  ].join("");
}
