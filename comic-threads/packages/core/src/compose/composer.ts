/**
 * Panel composer — the port of panel.cpp AddLine (l.359) driving LayoutAvatars
 * and LayoutBalloons. Break rules (verbatim semantics):
 *   - caption/event items force a panel break (SM_ACTION → StartNewPanel);
 *   - an utterance breaks to a new panel when the current panel already holds
 *     ≥5 balloons OR the speaker already has a balloon in it; otherwise it
 *     EXTENDS the current panel (the original cloned + re-laid-out the last
 *     panel; we accumulate an entry and re-run layout — same result).
 * Plus: addressee/@mention silent listeners, continuation splitting, code
 * terminal cards, and merge/close scene panels.
 */

import type {
  CodeBlock,
  Participant,
  Thread,
  ThreadItem,
  Utterance,
} from "../model.js";
import { isEvent } from "../model.js";
import {
  castParticipants,
  pickPose,
  type CharacterManifest,
  type Roster,
} from "../characters.js";
import { inferEmotion, NEUTRAL, type InferredEmotion } from "../emotion/engine.js";
import { checkForUppers } from "../emotion/engine.js";
import { rngFromString } from "../rng.js";
import { layoutAvatars, type CastMember, type LayoutContext } from "./layout.js";
import { layoutBalloons, type BalloonInput } from "./balloons.js";
import { splitForContinuation } from "./text.js";
import {
  BALLOON_FONT_SIZE,
  BALLOON_ZONE_HEIGHT,
  MAX_BALLOONS_PER_PANEL,
  MAX_BODIES_PER_PANEL,
  MAX_BALLOON_CHARS,
  MAX_CONTINUATION_PANELS,
  TERMINAL_FONT_SIZE,
  UNIT_HEIGHT,
  UNIT_WIDTH,
  type BalloonKind,
  type Comic,
  type ComicPage,
  type Panel,
  type ReactionStack,
  type TerminalCard,
} from "./types.js";

export interface ComposeOptions {
  roster: Roster;
  /** login -> character name. Derived from the roster if omitted. */
  casting?: Map<string, string>;
  /** forced casting overrides (viewer re-casting / "self"). */
  overrides?: Record<string, string>;
  /** panels-per-page for pagination. 0/undefined → single page. */
  panelsPerPage?: number;
}

interface Entry {
  login: string;
  kind: BalloonKind;
  text: string;
  emotion: InferredEmotion;
  reactions?: ReactionStack[];
  codeBlock?: CodeBlock;
  continued?: boolean;
}

interface Spec {
  kind: Panel["kind"];
  entries: Entry[];
  silent: Set<string>;
  wave: Set<string>;
  celebrate: string[];
  caption?: string;
  captionFlavor?: string;
  itemIndices: number[];
  establishing: boolean;
}

function reactionsToStacks(r?: Record<string, number>): ReactionStack[] | undefined {
  if (!r) return undefined;
  const stacks: ReactionStack[] = [];
  for (const [emoji, count] of Object.entries(r)) {
    if (count > 0) stacks.push({ emoji, count });
  }
  return stacks.length > 0 ? stacks : undefined;
}

function balloonKind(mode: "say" | "whisper", emotion: InferredEmotion, text: string): BalloonKind {
  if (mode === "whisper") return "whisper";
  if (emotion.emotion === "shout" || checkForUppers(text)) return "shout";
  return "speech";
}

function mentionsIn(text: string, participants: Set<string>): string[] {
  const out: string[] = [];
  const re = /@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const login = m[1]!;
    if (participants.has(login) && !out.includes(login)) out.push(login);
  }
  return out;
}

export function composeThread(thread: Thread, options: ComposeOptions): Comic {
  const { roster } = options;
  const participantLogins = thread.participants.map((p) => p.login);
  const participantSet = new Set(participantLogins);
  const roleByLogin = new Map<string, Participant>();
  for (const p of thread.participants) roleByLogin.set(p.login, p);

  const casting =
    options.casting ??
    castParticipants(participantLogins, roster, { overrides: options.overrides });

  const manifestFor = (login: string): CharacterManifest | undefined => {
    const name = casting.get(login);
    if (!name) return undefined;
    return roster.manifests.get(name);
  };

  // ---- Pass 1: build panel specs applying break rules --------------------
  const specs: Spec[] = [];
  let lastUtteranceAuthor: string | null = null;

  const newSpec = (kind: Panel["kind"], establishing: boolean): Spec => {
    const s: Spec = {
      kind,
      entries: [],
      silent: new Set(),
      wave: new Set(),
      celebrate: [],
      itemIndices: [],
      establishing,
    };
    specs.push(s);
    return s;
  };

  const currentNormal = (): Spec | null => {
    const last = specs[specs.length - 1];
    if (last && last.kind === "normal") return last;
    return null;
  };

  const bodyCount = (s: Spec): number => {
    const set = new Set<string>();
    for (const e of s.entries) set.add(e.login);
    for (const l of s.silent) set.add(l);
    return set.size;
  };

  const addUtteranceEntry = (
    itemIndex: number,
    login: string,
    entry: Entry,
    silentInvites: string[],
  ): void => {
    let cur = currentNormal();
    const mustBreak =
      !cur ||
      cur.entries.length >= MAX_BALLOONS_PER_PANEL ||
      cur.entries.some((e) => e.login === login);
    if (mustBreak) {
      cur = newSpec("normal", specs.length === 0);
    }
    const panel = cur!;
    panel.entries.push(entry);
    panel.itemIndices.push(itemIndex);
    // invite silent listeners while we have room (≤4 bodies).
    for (const inv of silentInvites) {
      if (inv === login) continue;
      if (panel.entries.some((e) => e.login === inv)) continue;
      if (bodyCount(panel) >= MAX_BODIES_PER_PANEL) break;
      panel.silent.add(inv);
    }
  };

  const recentSpeakers = (limit: number): string[] => {
    const seen: string[] = [];
    for (let i = specs.length - 1; i >= 0 && seen.length < limit; i--) {
      for (const e of specs[i]!.entries) {
        if (!seen.includes(e.login)) seen.push(e.login);
      }
    }
    return seen;
  };

  thread.items.forEach((item: ThreadItem, itemIndex) => {
    if (isEvent(item)) {
      // Events force a break and render as caption / scene panels.
      if (item.flavor === "merge") {
        const s = newSpec("celebration", false);
        s.caption = item.text;
        s.captionFlavor = item.flavor;
        s.celebrate = recentSpeakers(MAX_BODIES_PER_PANEL);
        s.itemIndices.push(itemIndex);
      } else if (item.flavor === "close") {
        const s = newSpec("caption", false);
        s.caption = item.text;
        s.captionFlavor = item.flavor;
        for (const l of recentSpeakers(MAX_BODIES_PER_PANEL)) s.wave.add(l);
        s.itemIndices.push(itemIndex);
      } else {
        const s = newSpec("caption", false);
        s.caption = item.text;
        s.captionFlavor = item.flavor;
        s.itemIndices.push(itemIndex);
      }
      return;
    }

    const utt = item as Utterance;
    const rng = rngFromString(thread.id, "emotion", itemIndex);
    let emotion = inferEmotion(utt.body, { rng });

    const mentions = mentionsIn(utt.body, participantSet);
    const isBot = roleByLogin.get(utt.author)?.role === "bot";

    // Code block → speaker points at the terminal card (F6).
    const hasCode = !!(utt.codeBlocks && utt.codeBlocks.length > 0);
    if (hasCode) emotion = { emotion: "pointother", intensity: 1, strength: 12 };
    // @mention → point-other, and the mentioned character is invited in.
    else if (mentions.length > 0 && emotion.emotion !== "pointother") {
      emotion = { emotion: "pointother", intensity: 1, strength: 9 };
    }

    // Continuation splitting at sentence boundaries (cap 3 panels).
    let chunks = splitForContinuation(utt.body.trim(), MAX_BALLOON_CHARS);
    let truncated = false;
    if (chunks.length > MAX_CONTINUATION_PANELS) {
      chunks = chunks.slice(0, MAX_CONTINUATION_PANELS);
      truncated = true;
    }
    // Bots: collapse walls of text into a single short caption-ish balloon.
    if (isBot && chunks.length > 1) {
      chunks = [chunks[0]!];
      truncated = true;
    }

    const shortReply = utt.body.trim().length < 60;
    const silentInvites: string[] = [];
    for (const mlogin of mentions) if (mlogin !== utt.author) silentInvites.push(mlogin);
    if (shortReply && lastUtteranceAuthor && lastUtteranceAuthor !== utt.author) {
      silentInvites.push(lastUtteranceAuthor);
    }

    chunks.forEach((chunk, ci) => {
      const isLast = ci === chunks.length - 1;
      let text = chunk;
      if (truncated && isLast) text = `${chunk} … (read more on GitHub)`;
      const kind = balloonKind(utt.mode, emotion, chunk);
      const entry: Entry = {
        login: utt.author,
        kind,
        text,
        emotion,
        reactions: ci === 0 ? reactionsToStacks(utt.reactions) : undefined,
        codeBlock: ci === 0 && utt.codeBlocks ? utt.codeBlocks[0] : undefined,
        continued: truncated && isLast,
      };
      addUtteranceEntry(itemIndex, utt.author, entry, ci === 0 ? silentInvites : []);
    });

    lastUtteranceAuthor = utt.author;
  });

  // ---- Pass 2: finalise each spec into a laid-out Panel ------------------
  const panels: Panel[] = [];
  let previousSlots = new Map<string, number>();

  const buildCastMember = (
    login: string,
    emotion: InferredEmotion,
    silent: boolean,
    panelIndex: number,
  ): CastMember | null => {
    const manifest = manifestFor(login);
    if (!manifest) return null;
    const poseRng = rngFromString(thread.id, "pose", panelIndex, login);
    const pose = pickPose(manifest, emotion, poseRng);
    return { login, character: manifest.name, emotion: emotion.emotion, pose, silent };
  };

  specs.forEach((spec, panelIndex) => {
    const rng = rngFromString(thread.id, "panel", panelIndex);
    const cast: CastMember[] = [];
    const seen = new Set<string>();

    if (spec.kind === "celebration") {
      spec.celebrate.forEach((login, i) => {
        if (seen.has(login)) return;
        const emo: InferredEmotion = { emotion: i % 2 === 0 ? "laugh" : "happy", intensity: 1, strength: 12 };
        const cm = buildCastMember(login, emo, false, panelIndex);
        if (cm) {
          cast.push(cm);
          seen.add(login);
        }
      });
    } else {
      for (const e of spec.entries) {
        if (seen.has(e.login)) continue;
        const cm = buildCastMember(e.login, e.emotion, false, panelIndex);
        if (cm) {
          cast.push(cm);
          seen.add(e.login);
        }
      }
      for (const login of spec.silent) {
        if (seen.has(login)) continue;
        const cm = buildCastMember(login, NEUTRAL, true, panelIndex);
        if (cm) {
          cast.push(cm);
          seen.add(login);
        }
      }
      for (const login of spec.wave) {
        if (seen.has(login)) continue;
        const emo: InferredEmotion = { emotion: "wave", intensity: 1, strength: 12 };
        const cm = buildCastMember(login, emo, false, panelIndex);
        if (cm) {
          cast.push(cm);
          seen.add(login);
        }
      }
    }

    const ctx: LayoutContext = {
      previousSlots,
      establishing: spec.establishing || cast.length >= MAX_BODIES_PER_PANEL,
    };
    const laid = layoutAvatars(cast, ctx, rng);
    if (laid.bodies.length > 0) previousSlots = laid.slots;

    // Balloons.
    const anchorByLogin = new Map<string, { x: number; y: number }>();
    for (const b of laid.bodies) anchorByLogin.set(b.login, { x: b.anchorX, y: b.anchorY });
    const balloonInputs: BalloonInput[] = [];
    for (const e of spec.entries) {
      const anchor = anchorByLogin.get(e.login) ?? { x: UNIT_WIDTH / 2, y: UNIT_HEIGHT * 0.55 };
      balloonInputs.push({
        kind: e.kind,
        text: e.text,
        fontSize: BALLOON_FONT_SIZE,
        speakerLogin: e.login,
        anchorX: anchor.x,
        anchorY: anchor.y,
        reactions: e.reactions,
        continued: e.continued,
      });
    }
    const balloons = layoutBalloons(balloonInputs);

    // Terminal card (first code block in the panel).
    let terminal: TerminalCard | undefined;
    const codeEntry = spec.entries.find((e) => e.codeBlock);
    if (codeEntry?.codeBlock) {
      terminal = buildTerminalCard(codeEntry.codeBlock);
    }

    panels.push({
      kind: spec.kind,
      bodies: laid.bodies,
      balloons,
      terminal,
      caption: spec.caption,
      captionFlavor: spec.captionFlavor,
      decorations: spec.kind === "celebration" ? ["stars"] : [],
      seed: (rng.int(1 << 30) >>> 0),
      itemIndices: spec.itemIndices,
    });
  });

  // ---- Pagination --------------------------------------------------------
  const perPage = options.panelsPerPage && options.panelsPerPage > 0 ? options.panelsPerPage : panels.length || 1;
  const pages: ComicPage[] = [];
  for (let i = 0; i < panels.length; i += perPage) {
    pages.push({ panels: panels.slice(i, i + perPage) });
  }
  if (pages.length === 0) pages.push({ panels: [] });

  return {
    id: thread.id,
    title: thread.title,
    url: thread.url,
    state: thread.state,
    pages,
    panels,
  };
}

function buildTerminalCard(code: CodeBlock): TerminalCard {
  const allLines = code.text.replace(/\n+$/g, "").split("\n");
  const MAX_LINES = 8;
  const truncated = allLines.length > MAX_LINES;
  const lines = truncated ? allLines.slice(0, MAX_LINES) : allLines;
  const lineHeight = Math.round(TERMINAL_FONT_SIZE * 1.35);
  const h = (lines.length + (truncated ? 1 : 0)) * lineHeight + 44;
  const w = Math.min(UNIT_WIDTH * 0.46, 480);
  const x = UNIT_WIDTH - w - 40;
  const y = BALLOON_ZONE_HEIGHT - 8;
  return { lang: code.lang, lines, truncated, x, y, w, h: Math.min(h, UNIT_HEIGHT * 0.42) };
}
