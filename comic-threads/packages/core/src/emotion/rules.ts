/**
 * Emotion rule tables.
 *
 * The FIRST block is a verbatim port of the rules Comic Chat 1.0 actually
 * shipped, from v1.0/client/chat.rc lines 1029–1036 (ID_RULE_SHOUT etc.).
 * Each string-table entry is a `\n`-separated list of "Function(arg);Strength"
 * primitives, all firing toward one emotion. We transcribe them exactly:
 *
 *   ID_RULE_SHOUT       AllCaps("");9  FindString("!!!");9
 *   ID_RULE_LAUGH       CheckWord("ROTFL");11  CheckWord("LOL");11
 *   ID_RULE_HAPPY       FindString(":)");10  FindString(":-)");10
 *   ID_RULE_SAD         FindString(":(");10  FindString(":-(");10
 *   ID_RULE_POINTOTHER  CheckStart("You");4  CheckWord*("are you");8 ...
 *   ID_RULE_POINTSELF   CheckStart("I");3  CheckWord*("i'm");7 ...
 *   ID_RULE_WAVE        CheckStart*("Hi");2  CheckStart*("Bye");3 ...
 *   ID_RULE_COY         FindString(";-)");10
 *   ID_RULE_ANGRY/SCARED/BORED were shipped EMPTY ("").
 *
 * `*` = case-insensitive variant (textpose.cpp RegisterRule). AllCaps fires
 * only when the text has >1 uppercase letter and no lowercase (CheckForUppers).
 *
 * The SECOND block is our clearly-separated MODERN table — emoji, GitHub
 * shortcodes, and review/PR vocabulary. It is additive and never edits the
 * originals.
 */

import type { EmotionName } from "./wheel.js";

export type RuleKind =
  | "allcaps"
  | "find" // FindString: raw substring
  | "word" // CheckWord: whole-word match
  | "start"; // CheckStart: sentence-start match

export interface Rule {
  kind: RuleKind;
  /** Search string (empty for allcaps). Stored as-authored. */
  arg: string;
  strength: number;
  /** false = the `*` case-insensitive variant. */
  caseSensitive: boolean;
  emotion: EmotionName;
  /** "original" (shipped 1996) or "modern" (our additions). */
  table: "original" | "modern";
}

const O = (
  kind: RuleKind,
  arg: string,
  strength: number,
  caseSensitive: boolean,
  emotion: EmotionName,
): Rule => ({ kind, arg, strength, caseSensitive, emotion, table: "original" });

const M = (
  kind: RuleKind,
  arg: string,
  strength: number,
  caseSensitive: boolean,
  emotion: EmotionName,
): Rule => ({ kind, arg, strength, caseSensitive, emotion, table: "modern" });

// ---------------------------------------------------------------------------
// Original shipped tables — chat.rc:1029–1036 (do not edit).
// ---------------------------------------------------------------------------
export const ORIGINAL_RULES: readonly Rule[] = [
  // ID_RULE_SHOUT
  O("allcaps", "", 9, true, "shout"),
  O("find", "!!!", 9, true, "shout"),
  // ID_RULE_LAUGH
  O("word", "ROTFL", 11, true, "laugh"),
  O("word", "LOL", 11, true, "laugh"),
  // ID_RULE_HAPPY
  O("find", ":)", 10, true, "happy"),
  O("find", ":-)", 10, true, "happy"),
  // ID_RULE_SAD
  O("find", ":(", 10, true, "sad"),
  O("find", ":-(", 10, true, "sad"),
  // ID_RULE_POINTOTHER
  O("start", "You", 4, true, "pointother"),
  O("word", "are you", 8, false, "pointother"),
  O("word", "will you", 8, false, "pointother"),
  O("word", "did you", 8, false, "pointother"),
  O("word", "aren't you", 8, false, "pointother"),
  O("word", "don't you", 8, false, "pointother"),
  // ID_RULE_POINTSELF
  O("start", "I", 3, true, "pointself"),
  O("word", "i'm", 7, false, "pointself"),
  O("word", "i will", 7, false, "pointself"),
  O("word", "i'll", 7, false, "pointself"),
  O("word", "i am", 7, false, "pointself"),
  // ID_RULE_WAVE
  O("start", "Hi", 2, false, "wave"),
  O("start", "Bye", 3, false, "wave"),
  O("start", "Hello", 5, false, "wave"),
  O("start", "Welcome", 5, false, "wave"),
  O("start", "Howdy", 5, false, "wave"),
  // ID_RULE_COY
  O("find", ";-)", 10, true, "coy"),
  // ID_RULE_ANGRY / SCARED / BORED shipped empty.
];

// ---------------------------------------------------------------------------
// Modern additions — emoji, shortcodes, and forum/PR vocabulary.
// ---------------------------------------------------------------------------
export const MODERN_RULES: readonly Rule[] = [
  // Emoji (matched as raw substrings; case is irrelevant for these).
  M("find", "😂", 10, true, "laugh"),
  M("find", "🤣", 10, true, "laugh"),
  M("find", "🎉", 9, true, "happy"),
  M("find", "😀", 8, true, "happy"),
  M("find", "😄", 8, true, "happy"),
  M("find", "😊", 7, true, "happy"),
  M("find", "❤️", 7, true, "happy"),
  M("find", "👍", 7, true, "happy"),
  M("find", "😢", 9, true, "sad"),
  M("find", "😞", 8, true, "sad"),
  M("find", "😠", 9, true, "angry"),
  M("find", "😡", 10, true, "angry"),
  M("find", "🤬", 11, true, "angry"),
  M("find", "😱", 9, true, "scared"),
  M("find", "😨", 8, true, "scared"),
  M("find", "🙄", 7, true, "bored"),
  M("find", "👋", 9, true, "wave"),
  M("find", "🤷", 9, true, "shrug"),

  // GitHub shortcodes.
  M("find", ":tada:", 9, false, "happy"),
  M("find", ":+1:", 6, false, "happy"),
  M("find", ":shipit:", 9, false, "happy"),
  M("find", ":lgtm-ish:", 8, false, "happy"),
  M("find", ":fire:", 8, false, "shout"),
  M("find", ":sob:", 9, false, "sad"),
  M("find", ":rage:", 10, false, "angry"),
  M("find", ":-1:", 6, false, "sad"),

  // Forum / PR review vocabulary.
  M("word", "lgtm", 10, false, "happy"),
  M("word", "ship it", 9, false, "happy"),
  M("word", "wtf", 9, false, "angry"),
  M("word", "wow", 7, false, "scared"),
  M("word", "thanks", 6, false, "happy"),
  M("word", "thank you", 6, false, "happy"),
  M("word", "sorry", 6, false, "sad"),
  M("find", "???", 8, false, "scared"),
  M("word", "hmm", 4, false, "bored"),
  M("find", "nit:", 5, false, "coy"),
  M("find", "+1", 6, false, "happy"),
  M("find", "-1", 6, false, "sad"),
  M("word", "broken", 7, false, "sad"),
  M("word", "crash", 7, false, "sad"),
  M("word", "urgent", 8, false, "shout"),
  M("word", "asap", 8, false, "shout"),
];

export const ALL_RULES: readonly Rule[] = [...ORIGINAL_RULES, ...MODERN_RULES];
