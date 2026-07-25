/**
 * Text measurement WITHOUT a canvas — the core runs in Node, so we measure with
 * a per-character advance-width table calibrated for a Comic-Sans-ish font.
 * Widths are fractions of the font size; good enough to pack balloons and wrap
 * lines deterministically (panel.cpp used real GDI metrics; we approximate).
 */

// Advance widths as a fraction of em, for the comic font stack.
const NARROW = new Set("iíljĳ!.,;:'|".split(""));
const THIN = new Set("ftrI()[]{}/\\-".split(""));
const WIDE = new Set("mwMW@%".split(""));
const CAP = new Set("ABCDEFGHKNOPQRSUVXYZ".split(""));

function charEm(ch: string): number {
  if (ch === " ") return 0.3;
  if (ch === "\t") return 1.2;
  if (NARROW.has(ch)) return 0.32;
  if (THIN.has(ch)) return 0.4;
  if (WIDE.has(ch)) return 0.92;
  if (CAP.has(ch)) return 0.72;
  const code = ch.codePointAt(0) ?? 0;
  if (code > 0x2000) return 1.0; // emoji / wide unicode
  return 0.56;
}

export function measureText(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += charEm(ch) * fontSize;
  return w;
}

/** Width of the widest single word (used to bound minimum balloon width). */
export function widestWord(text: string, fontSize: number): number {
  let max = 0;
  for (const word of text.split(/\s+/)) {
    max = Math.max(max, measureText(word, fontSize));
  }
  return max;
}

export interface WrappedText {
  lines: string[];
  width: number; // width of the widest line
  height: number; // total block height
  lineHeight: number;
}

/**
 * Greedy word-wrap into `maxWidth`. Words longer than a line are hard-split.
 * Returns the laid-out lines plus the measured block box.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): WrappedText {
  const lineHeight = Math.round(fontSize * 1.28);
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";

  const pushLongWord = (word: string) => {
    let chunk = "";
    for (const ch of word) {
      if (measureText(chunk + ch, fontSize) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    cur = chunk;
  };

  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (measureText(candidate, fontSize) <= maxWidth) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      if (measureText(word, fontSize) > maxWidth) {
        pushLongWord(word);
      } else {
        cur = word;
      }
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) lines.push("");

  let width = 0;
  for (const l of lines) width = Math.max(width, measureText(l, fontSize));
  return { lines, width, height: lines.length * lineHeight, lineHeight };
}

/** Split text into sentences at `.!?` boundaries, keeping the terminators. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?]*[.!?]+["')\]]?\s*|[^.!?]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out.length > 0 ? out : [text.trim()].filter(Boolean);
}

/**
 * Split `text` into chunks each no longer than `maxChars`, preferring sentence
 * boundaries; falls back to word boundaries for a single very long sentence.
 */
export function splitForContinuation(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (cur) {
        chunks.push(cur.trim());
        cur = "";
      }
      // hard-split the oversized sentence by words
      let piece = "";
      for (const word of s.split(" ")) {
        if ((piece + " " + word).length > maxChars && piece) {
          chunks.push(piece.trim());
          piece = word;
        } else {
          piece = piece ? `${piece} ${word}` : word;
        }
      }
      if (piece) cur = piece;
      continue;
    }
    if ((cur + " " + s).length > maxChars && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
