/**
 * The emotion rule engine — a port of textpose.cpp's GetEmotionsFromString and
 * its primitives (CheckForUppers, CheckWord, StartCompare2, GetNextSentence-
 * Start). Rules fire options; the strongest wins. The original resolved ties
 * by table order; per the design spec we resolve ties with a seeded RNG so the
 * behaviour is reproducible yet not order-biased.
 */

import type { EmotionName } from "./wheel.js";
import { ALL_RULES, ORIGINAL_RULES, type Rule } from "./rules.js";
import type { Rng } from "../rng.js";

export interface InferredEmotion {
  emotion: EmotionName;
  /** intensity radius 0..1 (0 for neutral). */
  intensity: number;
  /** winning rule strength (0 when nothing fired → neutral). */
  strength: number;
}

export const NEUTRAL: InferredEmotion = {
  emotion: "neutral",
  intensity: 0,
  strength: 0,
};

// --- ASCII character-class helpers (matching C isupper/islower/isspace/etc.) ---

function isAsciiUpper(c: string): boolean {
  return c >= "A" && c <= "Z";
}
function isAsciiLower(c: string): boolean {
  return c >= "a" && c <= "z";
}
function isAsciiAlnum(c: string): boolean {
  return (c >= "0" && c <= "9") || isAsciiUpper(c) || isAsciiLower(c);
}
function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
}
function isPunct(c: string): boolean {
  // C ispunct: printable, not alnum, not space.
  const code = c.charCodeAt(0);
  return code > 32 && code < 127 && !isAsciiAlnum(c);
}

/** CheckForUppers: >1 uppercase letter AND no lowercase letters. */
export function checkForUppers(buff: string): boolean {
  let nUppers = 0;
  for (const ch of buff) {
    if (isAsciiLower(ch)) return false;
    if (isAsciiUpper(ch)) nUppers++;
  }
  return nUppers > 1;
}

/** CheckWord: `substr` occurs as a whole word (whitespace/start before, ws/punct/end after). */
export function checkWord(buff: string, substr: string): boolean {
  if (substr.length === 0) return false;
  let from = 0;
  for (;;) {
    const loc = buff.indexOf(substr, from);
    if (loc < 0) return false;
    const before = loc === 0 ? "" : buff[loc - 1]!;
    const afterIdx = loc + substr.length;
    const after = afterIdx < buff.length ? buff[afterIdx]! : "";
    const startsWord = loc === 0 || isSpace(before);
    const endsWord = after === "" || isSpace(after) || isPunct(after);
    if (startsWord && endsWord) return true;
    from = loc + 1;
  }
}

/** StartCompare2: `substr` matches at position 0 of `sent` and the following char is not alnum. */
function startCompare(sent: string, substr: string): boolean {
  if (!sent.startsWith(substr)) return false;
  const after = sent[substr.length];
  return after === undefined || !isAsciiAlnum(after);
}

const SENTENCE_TERMINATORS = new Set([".", "!", "?"]);

/**
 * GetNextSentenceStart: from `buff`, find the first `.!?`, then skip any
 * following punctuation/whitespace and return the remaining string (or null).
 */
export function getNextSentenceStart(buff: string): string | null {
  let i = 0;
  while (i < buff.length && !SENTENCE_TERMINATORS.has(buff[i]!)) i++;
  if (i >= buff.length) return null;
  // skip the run of punctuation/whitespace after the terminator
  while (i < buff.length && (isPunct(buff[i]!) || isSpace(buff[i]!))) i++;
  if (i >= buff.length) return "";
  return buff.slice(i);
}

/** Enumerate every sentence-start substring of `buff`. */
function sentenceStarts(buff: string): string[] {
  const starts: string[] = [];
  let cur: string | null = buff.replace(/^\s+/, "");
  while (cur && cur.length > 0) {
    starts.push(cur);
    cur = getNextSentenceStart(cur);
  }
  return starts;
}

interface FiredOption {
  emotion: EmotionName;
  intensity: number;
  strength: number;
}

function runRules(text: string, rules: readonly Rule[]): FiredOption[] {
  const opts: FiredOption[] = [];
  const lower = text.toLowerCase();
  const starts = sentenceStarts(text);
  const startsLower = starts.map((s) => s.toLowerCase());

  for (const rule of rules) {
    switch (rule.kind) {
      case "allcaps": {
        if (checkForUppers(text)) {
          opts.push({ emotion: rule.emotion, intensity: 1, strength: rule.strength });
        }
        break;
      }
      case "find": {
        const hay = rule.caseSensitive ? text : lower;
        const needle = rule.caseSensitive ? rule.arg : rule.arg.toLowerCase();
        if (hay.includes(needle)) {
          opts.push({ emotion: rule.emotion, intensity: 1, strength: rule.strength });
        }
        break;
      }
      case "word": {
        const hay = rule.caseSensitive ? text : lower;
        const needle = rule.caseSensitive ? rule.arg : rule.arg.toLowerCase();
        if (checkWord(hay, needle)) {
          opts.push({ emotion: rule.emotion, intensity: 1, strength: rule.strength });
        }
        break;
      }
      case "start": {
        const list = rule.caseSensitive ? starts : startsLower;
        const needle = rule.caseSensitive ? rule.arg : rule.arg.toLowerCase();
        if (list.some((s) => startCompare(s, needle))) {
          opts.push({ emotion: rule.emotion, intensity: 1, strength: rule.strength });
        }
        break;
      }
    }
  }
  return opts;
}

export interface InferOptions {
  /** Rule set to use. Defaults to original + modern. */
  rules?: readonly Rule[];
  /** Seeded RNG for tie-breaks. If omitted, ties resolve to the first max. */
  rng?: Rng;
}

/**
 * Strip fenced code blocks, inline code, URLs and blockquotes from `text`
 * BEFORE emotion inference (so a ```SHOUTING``` code sample doesn't scream).
 */
export function stripMarkup(text: string): string {
  let t = text;
  // fenced code blocks ``` ... ``` (and ~~~)
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/~~~[\s\S]*?~~~/g, " ");
  // blockquote lines
  t = t
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  // inline code
  t = t.replace(/`[^`]*`/g, " ");
  // URLs
  t = t.replace(/https?:\/\/\S+/g, " ");
  // markdown link syntax [text](url) -> keep text
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  return t;
}

/**
 * Infer a single dominant emotion from raw comment text. Highest-strength rule
 * wins; ties are broken with the supplied seeded RNG (or the first match when
 * no RNG is given). Returns NEUTRAL when nothing fires.
 */
export function inferEmotion(rawText: string, options: InferOptions = {}): InferredEmotion {
  const rules = options.rules ?? ALL_RULES;
  const text = stripMarkup(rawText);
  const opts = runRules(text, rules);
  if (opts.length === 0) return NEUTRAL;

  let max = 0;
  for (const o of opts) if (o.strength > max) max = o.strength;
  const winners = opts.filter((o) => o.strength === max);

  const chosen =
    winners.length === 1 || !options.rng
      ? winners[0]!
      : options.rng.pick(winners);

  return { emotion: chosen.emotion, intensity: chosen.intensity, strength: chosen.strength };
}

/** Convenience: infer using ONLY the original 1996 tables (for parity tests). */
export function inferOriginal(rawText: string, rng?: Rng): InferredEmotion {
  return inferEmotion(rawText, { rules: ORIGINAL_RULES, rng });
}
