/**
 * Markdown → spoken words. Verbatim copy of the web app's speech.ts (no DOM,
 * no storage — pure text transform, safe to share as-is until this and
 * roster/comic/casting move into a real shared package).
 *
 * `github-source` normalises a comment into an `Utterance` whose body is still
 * GitHub-flavoured markdown, with fenced code lifted out and replaced by
 * `[code:N]` placeholders pointing at `codeBlocks[N-1]`. Core takes that body as
 * plain text and puts it straight into a balloon, so without this step a panel
 * says "here is the fix [code:1]" and a comment full of `**bold**` reads its own
 * asterisks aloud. Characters speak, so the syntax comes off.
 *
 * Deliberately conservative: it removes notation, never words. Code blocks are
 * already drawn as a terminal card next to the speaker, so their placeholder
 * just goes; everything else keeps its text and loses its punctuation scaffold.
 */

import { CODE_PLACEHOLDER_RE } from "@comic-threads/github-source";
import type { Thread, ThreadItem, Utterance } from "@comic-threads/core";

/** What a speaker says when their whole comment was a code block. */
const WORDLESS = "…";

export function toSpokenText(body: string): string {
  let t = body;

  // The code is drawn as a terminal card; the placeholder is bookkeeping.
  t = t.replace(new RegExp(CODE_PLACEHOLDER_RE.source, "g"), " ");
  // HTML comments (<!-- PR template boilerplate -->) are not dialogue.
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  // Images speak as their alt text, links as their label.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Reference-style and autolinks.
  t = t.replace(/<(https?:\/\/[^>]+)>/g, "$1");
  // Line-leading notation: headings, quote markers, list bullets, rules.
  t = t
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>+\s?/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, ""),
    )
    .filter((line) => !/^\s*([-*_]\s*){3,}$/.test(line))
    .join("\n");
  // Emphasis, strikethrough and inline-code fences around words we keep. The
  // boundary guards matter: without them `PARTY_MODE is wild. Rename to
  // ENABLE_STROBE_OF_DOOM` gets read as emphasis and spoken as PARTYMODE …
  // ENABLESTROBEOFDOOM. GFM does not allow intraword `_` either. A `__`
  // pair wrapping a single whitespace-free token (`__init__`, `__main__`)
  // reads as a dunder identifier, not bold, even though nothing outside it
  // is a word character — so that case is excluded separately below.
  t = t.replace(/(?<![\w*])\*\*(?=\S)([\s\S]*?\S)\*\*(?![\w*])/g, "$1");
  t = t.replace(/(?<![\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/g, (m, inner: string) =>
    /^\S+$/.test(inner) ? m : inner,
  );
  t = t.replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1");
  t = t.replace(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, "$1");
  t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  t = t.replace(/`+/g, "");

  return t.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

function speakUtterance(item: Utterance): Utterance {
  const body = toSpokenText(item.body);
  const hasCode = !!item.codeBlocks?.length;
  const spoken = body || (hasCode ? WORDLESS : "");
  return spoken === item.body ? item : { ...item, body: spoken };
}

/** Rewrite every utterance body for the stage. Events are already prose. */
export function toSpokenThread(thread: Thread): Thread {
  let changed = false;
  const items: ThreadItem[] = thread.items.map((item) => {
    if (item.kind !== "utterance") return item;
    const next = speakUtterance(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? { ...thread, items } : thread;
}
