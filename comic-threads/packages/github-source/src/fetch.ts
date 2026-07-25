/**
 * fetchThread — GitHub REST ingest (DESIGN.md F1, §4.4).
 *
 * Pulls an issue or PR, its comments, its timeline events and (for PRs) its
 * reviews and review comments, then normalizes everything into core's
 * source-agnostic `Thread`. No dependencies: plain `fetch`, so this runs
 * unchanged in Node 20+ and in the browser.
 *
 * Comic-relevant normalizations, per §4.4:
 *  - fenced code blocks are lifted out of balloon text into `codeBlocks`,
 *    leaving a `[code:N]` placeholder behind (F6);
 *  - bot walls of text collapse into caption-style summaries;
 *  - consecutive label/assign/commit chatter batches into one caption;
 *  - review states map onto the caption flavors the composer knows about.
 */

import type {
  CodeBlock,
  EventFlavor,
  Participant,
  ParticipantRole,
  Thread,
  ThreadEvent,
  ThreadItem,
  ThreadState,
  Utterance,
} from "@comic-threads/core";
import type {
  GhComment,
  GhIssue,
  GhReview,
  GhReviewComment,
  GhTimelineEvent,
  GhUser,
} from "./apiTypes.js";
import { threadHtmlUrl } from "./url.js";

/** Minimal reference a fetch needs; `parseThreadUrl` returns a superset. */
export interface FetchRef {
  owner: string;
  repo: string;
  number: number;
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export interface FetchThreadOptions {
  /** Personal access token (F11). Sent only to the configured API base. */
  token?: string;
  /** Injectable fetch — used by tests and by shells with custom transports. */
  fetchImpl?: FetchLike;
  /** Defaults to https://api.github.com */
  baseUrl?: string;
  /** Hard cap on pages fetched per collection (100 items/page). */
  maxPages?: number;
  signal?: AbortSignal;
}

export const API_BASE = "https://api.github.com";
const PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 10;

/** Bodies longer than this from a bot become a caption summary, not a balloon. */
export const BOT_SUMMARY_THRESHOLD = 240;
const BOT_SUMMARY_MAX = 150;

/** Emitted where a fenced code block was lifted out of an utterance body. */
export function codePlaceholder(index: number): string {
  return `[code:${index + 1}]`;
}
export const CODE_PLACEHOLDER_RE = /\[code:(\d+)\]/g;

export class GitHubFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly rateLimitReset?: number,
  ) {
    super(message);
    this.name = "GitHubFetchError";
  }
}

/** Headers every request carries; `token` is optional (60 req/h anonymous). */
export function ghHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Parses `x-ratelimit-reset` (unix seconds) into epoch ms, if present. */
export function rateLimitResetMs(res: { headers: Headers }): number | undefined {
  const raw = res.headers.get("x-ratelimit-reset");
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}

function resolveFetch(impl?: FetchLike): FetchLike {
  if (impl) return impl;
  const g = globalThis.fetch;
  if (!g) throw new Error("No global fetch available; pass opts.fetchImpl");
  return ((input, init) => g(input, init as RequestInit)) as FetchLike;
}

async function getJson<T>(
  url: string,
  opts: FetchThreadOptions,
): Promise<{ data: T; res: Response }> {
  const doFetch = resolveFetch(opts.fetchImpl);
  const res = await doFetch(url, { headers: ghHeaders(opts.token), signal: opts.signal });
  if (!res.ok) {
    throw new GitHubFetchError(
      `GitHub ${res.status} for ${url}`,
      res.status,
      url,
      rateLimitResetMs(res),
    );
  }
  return { data: (await res.json()) as T, res };
}

/** Follows `Link: rel="next"`, falling back to a short-page check. */
async function getAllPages<T>(
  url: string,
  opts: FetchThreadOptions,
): Promise<T[]> {
  const max = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const out: T[] = [];
  let next: string | undefined = addQuery(url, { per_page: String(PER_PAGE) });
  for (let page = 0; page < max && next; page++) {
    const { data, res }: { data: T[]; res: Response } = await getJson<T[]>(next, opts);
    if (!Array.isArray(data)) break;
    out.push(...data);
    const link = nextLink(res.headers.get("link"));
    next = link ?? (data.length === PER_PAGE ? addQuery(url, {
      per_page: String(PER_PAGE),
      page: String(page + 2),
    }) : undefined);
  }
  return out;
}

export function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (m) return m[1];
  }
  return undefined;
}

function addQuery(url: string, params: Record<string, string>): string {
  const sep = url.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${url}${sep}${qs}`;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n`]*)\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm;

/**
 * Lifts fenced code blocks out of `body` (F6). Returns the rewritten body with
 * `[code:N]` placeholders and the extracted blocks in document order.
 */
export function extractCodeBlocks(body: string): { body: string; codeBlocks: CodeBlock[] } {
  const codeBlocks: CodeBlock[] = [];
  const src = body.replace(/\r\n/g, "\n");
  const rewritten = src.replace(FENCE_RE, (_all, indent: string, _f, info: string, code: string) => {
    const placeholder = codePlaceholder(codeBlocks.length);
    codeBlocks.push({
      lang: (info || "").trim().split(/\s+/)[0] ?? "",
      text: code.replace(/\s+$/, ""),
    });
    return `${indent}${placeholder}`;
  });
  return { body: tidy(rewritten), codeBlocks };
}

/** Strips HTML comments and collapses runaway blank lines. */
function tidy(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isBotLogin(login: string, user?: GhUser): boolean {
  return login.endsWith("[bot]") || user?.type === "Bot";
}

/**
 * Collapses a bot's wall of text into a caption-length summary (§4.4:
 * "body collapsed into caption summary").
 */
export function summarizeBotBody(login: string, body: string): string {
  const flat = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*[|>#*\-]+\s*/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  // A one-word first "sentence" is no summary at all; fall back to the body.
  let summary = firstSentence.length >= 15 ? firstSentence : flat;
  if (summary.length > BOT_SUMMARY_MAX) {
    summary = `${summary.slice(0, BOT_SUMMARY_MAX).replace(/\s+\S*$/, "")}…`;
  }
  return summary ? `${login}: ${summary}` : `${login} posted an update`;
}

const REACTION_EMOJI: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

function normalizeReactions(r?: Record<string, unknown>): Record<string, number> | undefined {
  if (!r) return undefined;
  const out: Record<string, number> = {};
  for (const [key, emoji] of Object.entries(REACTION_EMOJI)) {
    const count = r[key];
    if (typeof count === "number" && count > 0) out[emoji] = count;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

class ParticipantIndex {
  private readonly byLogin = new Map<string, Participant>();
  constructor(private readonly authorLogin: string) {}

  add(user: GhUser | null | undefined, association?: string): string | undefined {
    if (!user?.login) return undefined;
    const login = user.login;
    const existing = this.byLogin.get(login);
    const role = this.roleFor(login, user, association);
    if (existing) {
      if (rank(role) > rank(existing.role)) existing.role = role;
      if (!existing.avatarUrl && user.avatar_url) existing.avatarUrl = user.avatar_url;
      return login;
    }
    this.byLogin.set(login, {
      login,
      displayName: displayNameFor(login),
      avatarUrl: user.avatar_url,
      role,
    });
    return login;
  }

  private roleFor(login: string, user: GhUser, association?: string): ParticipantRole {
    if (isBotLogin(login, user)) return "bot";
    if (login === this.authorLogin) return "author";
    if (association && MAINTAINER_ASSOCIATIONS.has(association)) return "maintainer";
    return "contributor";
  }

  list(): Participant[] {
    return [...this.byLogin.values()];
  }

  has(login: string): boolean {
    return this.byLogin.has(login);
  }
}

/** author beats maintainer beats contributor; bot is sticky. */
function rank(role: ParticipantRole): number {
  return role === "bot" ? 4 : role === "author" ? 3 : role === "maintainer" ? 2 : 1;
}

function displayNameFor(login: string): string {
  return login.endsWith("[bot]") ? login.slice(0, -"[bot]".length) : login;
}

// ---------------------------------------------------------------------------
// Item construction
// ---------------------------------------------------------------------------

/** Batchable events carry the raw detail so a run can be merged into one caption. */
interface Batchable {
  verb: "added-label" | "removed-label" | "assigned" | "unassigned" | "committed";
  detail?: string;
  /** Display name to narrate with when there is no GitHub actor (git commits). */
  who?: string;
}

interface Pending {
  item: ThreadItem;
  batch?: Batchable;
  /** stable ordering tiebreaker so equal timestamps keep source order */
  seq: number;
}

function utterance(
  author: string,
  rawBody: string,
  ts: string,
  mode: "say" | "whisper",
  reactions?: Record<string, unknown>,
): Utterance {
  const { body, codeBlocks } = extractCodeBlocks(rawBody);
  const item: Utterance = { kind: "utterance", author, body, ts, mode };
  const r = normalizeReactions(reactions);
  if (r) item.reactions = r;
  if (codeBlocks.length > 0) item.codeBlocks = codeBlocks;
  return item;
}

function event(ts: string, text: string, flavor: EventFlavor, actor?: string): ThreadEvent {
  const e: ThreadEvent = { kind: "event", ts, text, flavor };
  if (actor) e.actor = actor;
  return e;
}

// ---------------------------------------------------------------------------
// fetchThread
// ---------------------------------------------------------------------------

export async function fetchThread(
  ref: FetchRef,
  opts: FetchThreadOptions = {},
): Promise<Thread> {
  const base = opts.baseUrl ?? API_BASE;
  const repoUrl = `${base}/repos/${ref.owner}/${ref.repo}`;
  const issueUrl = `${repoUrl}/issues/${ref.number}`;

  const { data: issue } = await getJson<GhIssue>(issueUrl, opts);
  const isPull = !!issue.pull_request;

  const [comments, timeline] = await Promise.all([
    getAllPages<GhComment>(`${issueUrl}/comments`, opts),
    getAllPages<GhTimelineEvent>(`${issueUrl}/timeline`, opts).catch(() => [] as GhTimelineEvent[]),
  ]);

  let reviews: GhReview[] = [];
  let reviewComments: GhReviewComment[] = [];
  if (isPull) {
    const pullUrl = `${repoUrl}/pulls/${ref.number}`;
    [reviews, reviewComments] = await Promise.all([
      getAllPages<GhReview>(`${pullUrl}/reviews`, opts).catch(() => [] as GhReview[]),
      getAllPages<GhReviewComment>(`${pullUrl}/comments`, opts).catch(
        () => [] as GhReviewComment[],
      ),
    ]);
  }

  return normalizeThread({ ref, issue, comments, timeline, reviews, reviewComments });
}

export interface RawThreadData {
  ref: FetchRef;
  issue: GhIssue;
  comments: GhComment[];
  timeline: GhTimelineEvent[];
  reviews: GhReview[];
  reviewComments: GhReviewComment[];
}

/** Pure normalization — exported so tests (and fixtures/demo mode) can drive it. */
export function normalizeThread(raw: RawThreadData): Thread {
  const { ref, issue, comments, timeline, reviews, reviewComments } = raw;
  const isPull = !!issue.pull_request;
  const mergedAt = issue.pull_request?.merged_at ?? null;
  const authorLogin = issue.user?.login ?? "ghost";

  const people = new ParticipantIndex(authorLogin);
  people.add(issue.user, issue.author_association);

  const pending: Pending[] = [];
  let seq = 0;
  const push = (item: ThreadItem, batch?: Batchable) => {
    pending.push({ item, batch, seq: seq++ });
  };

  // --- opened -------------------------------------------------------------
  push(
    event(
      issue.created_at,
      `${authorLogin} opened this ${isPull ? "pull request" : "issue"}`,
      "open",
      authorLogin,
    ),
  );

  // --- issue body ---------------------------------------------------------
  const body = (issue.body ?? "").trim();
  if (body) {
    push(
      makeUtteranceOrSummary(
        authorLogin,
        isBotLogin(authorLogin, issue.user),
        body,
        issue.created_at,
        "say",
        issue.reactions as Record<string, unknown> | undefined,
      ),
    );
  }

  // --- comments -----------------------------------------------------------
  for (const c of comments) {
    const login = people.add(c.user, c.author_association);
    if (!login) continue;
    push(
      makeUtteranceOrSummary(
        login,
        isBotLogin(login, c.user),
        c.body ?? "",
        c.created_at,
        "say",
        c.reactions as Record<string, unknown> | undefined,
      ),
    );
  }

  // --- PR review comments (whispers) --------------------------------------
  for (const rc of reviewComments) {
    const login = people.add(rc.user, rc.author_association);
    if (!login || !(rc.body ?? "").trim()) continue;
    push(
      makeUtteranceOrSummary(
        login,
        isBotLogin(login, rc.user),
        rc.body,
        rc.created_at,
        "whisper",
        rc.reactions as Record<string, unknown> | undefined,
      ),
    );
  }

  // --- reviews ------------------------------------------------------------
  for (const rv of reviews) {
    const login = people.add(rv.user, rv.author_association);
    if (!login) continue;
    const ts = rv.submitted_at ?? issue.created_at;
    const state = (rv.state ?? "").toUpperCase();
    const reviewBody = (rv.body ?? "").trim();

    if (state === "APPROVED") {
      push(event(ts, `✓ ${login} approved these changes`, "review-approve", login));
    } else if (state === "CHANGES_REQUESTED") {
      push(event(ts, `${login} requested changes`, "review-changes", login));
    } else if (state === "DISMISSED") {
      push(event(ts, `${login}'s review was dismissed`, "misc", login));
    }
    // A review's own body is spoken aloud (the review comments are whispers).
    if (reviewBody) {
      push(makeUtteranceOrSummary(login, isBotLogin(login, rv.user ?? undefined), reviewBody, ts, "say"));
    }
  }

  // --- timeline events ----------------------------------------------------
  for (const ev of timeline) {
    const mapped = mapTimelineEvent(ev, people, isPull, mergedAt);
    if (mapped) push(mapped.item, mapped.batch);
  }

  // --- order, batch -------------------------------------------------------
  pending.sort((a, b) => {
    const t = Date.parse(a.item.ts) - Date.parse(b.item.ts);
    if (Number.isNaN(t)) return a.seq - b.seq;
    return t !== 0 ? t : a.seq - b.seq;
  });

  const items = batchMinorEvents(pending);

  return {
    source: "github",
    id: `${ref.owner}/${ref.repo}#${ref.number}`,
    title: issue.title,
    url: issue.html_url || threadHtmlUrl({ ...ref, type: isPull ? "pull" : "issues" }, isPull),
    state: threadState(issue, mergedAt),
    participants: people.list(),
    items,
  };
}

function threadState(issue: GhIssue, mergedAt: string | null): ThreadState {
  if (mergedAt) return "merged";
  return issue.state === "closed" ? "closed" : "open";
}

function makeUtteranceOrSummary(
  login: string,
  bot: boolean,
  rawBody: string,
  ts: string,
  mode: "say" | "whisper",
  reactions?: Record<string, unknown>,
): ThreadItem {
  const trimmed = (rawBody ?? "").trim();
  if (bot && trimmed.length > BOT_SUMMARY_THRESHOLD) {
    return event(ts, summarizeBotBody(login, trimmed), "misc", login);
  }
  return utterance(login, trimmed, ts, mode, reactions);
}

/** Events we drop entirely — pure bookkeeping with no narrative value. */
const IGNORED_EVENTS = new Set([
  "commented",
  "reviewed",
  "line-commented",
  "commit-commented",
  "subscribed",
  "unsubscribed",
  "mentioned",
  "labeled_dup",
  "user_blocked",
  "automatic_base_change_succeeded",
  "base_ref_changed",
  "connected",
  "disconnected",
  "convert_to_draft",
  "ready_for_review",
]);

function mapTimelineEvent(
  ev: GhTimelineEvent,
  people: ParticipantIndex,
  isPull: boolean,
  mergedAt: string | null,
): { item: ThreadItem; batch?: Batchable } | undefined {
  const name = ev.event;
  if (!name || IGNORED_EVENTS.has(name)) return undefined;
  const ts = ev.created_at ?? ev.committer?.date ?? ev.author?.date;
  if (!ts) return undefined;
  const actor = people.add(ev.actor ?? undefined) ?? ev.actor?.login;

  switch (name) {
    case "labeled":
      return {
        item: event(ts, `${actor ?? "someone"} added a label`, "label", actor),
        batch: { verb: "added-label", detail: ev.label?.name },
      };
    case "unlabeled":
      return {
        item: event(ts, `${actor ?? "someone"} removed a label`, "label", actor),
        batch: { verb: "removed-label", detail: ev.label?.name },
      };
    case "assigned":
      return {
        item: event(ts, `${actor ?? "someone"} assigned this`, "assign", actor),
        batch: { verb: "assigned", detail: ev.assignee?.login },
      };
    case "unassigned":
      return {
        item: event(ts, `${actor ?? "someone"} unassigned this`, "assign", actor),
        batch: { verb: "unassigned", detail: ev.assignee?.login },
      };
    case "committed": {
      const who = ev.author?.name ?? actor ?? "someone";
      const subject = (ev.message ?? "").split("\n")[0]?.trim();
      return {
        item: event(ts, `${who} pushed a commit`, "commit", actor),
        batch: { verb: "committed", detail: subject || undefined, who },
      };
    }
    case "referenced":
      return {
        item: event(
          ts,
          `${actor ?? "someone"} referenced this from a commit`,
          "commit",
          actor,
        ),
      };
    case "cross-referenced":
      return { item: event(ts, `${actor ?? "someone"} referenced this elsewhere`, "misc", actor) };
    case "merged":
      return {
        item: event(ts, `${actor ?? "someone"} merged this pull request 🎉`, "merge", actor),
      };
    case "closed":
      // A merge already tells the story; don't narrate the close twice.
      if (mergedAt) return undefined;
      return {
        item: event(
          ts,
          `${actor ?? "someone"} closed this ${isPull ? "pull request" : "issue"}`,
          "close",
          actor,
        ),
      };
    case "reopened":
      return { item: event(ts, `${actor ?? "someone"} reopened this`, "open", actor) };
    case "review_requested": {
      const who = ev.requested_reviewer?.login ?? ev.requested_team?.name ?? "a reviewer";
      people.add(ev.requested_reviewer ?? undefined);
      return { item: event(ts, `${actor ?? "someone"} requested a review from ${who}`, "misc", actor) };
    }
    case "renamed":
      return {
        item: event(ts, `${actor ?? "someone"} renamed this to “${ev.rename?.to ?? "?"}”`, "misc", actor),
      };
    case "milestoned":
      return {
        item: event(ts, `${actor ?? "someone"} added this to ${ev.milestone?.title ?? "a milestone"}`, "misc", actor),
      };
    case "head_ref_force_pushed":
      return { item: event(ts, `${actor ?? "someone"} force-pushed the branch`, "commit", actor) };
    case "pinned":
    case "unpinned":
    case "locked":
    case "unlocked":
      return { item: event(ts, `${actor ?? "someone"} ${name} this`, "misc", actor) };
    default:
      return undefined;
  }
}

const BATCHABLE_FLAVORS = new Set<EventFlavor>(["label", "assign", "commit"]);

/**
 * Collapses runs of consecutive minor events by the same actor into a single
 * caption (§4.4: "Labels/assign/commits → caption boxes, batched if
 * consecutive").
 */
function batchMinorEvents(pending: Pending[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  let i = 0;
  while (i < pending.length) {
    const head = pending[i]!;
    const item = head.item;
    if (item.kind !== "event" || !head.batch || !BATCHABLE_FLAVORS.has(item.flavor)) {
      out.push(item);
      i++;
      continue;
    }
    const run: Pending[] = [head];
    let j = i + 1;
    while (j < pending.length) {
      const nxt = pending[j]!;
      if (
        nxt.item.kind === "event" &&
        nxt.batch &&
        nxt.item.flavor === item.flavor &&
        nxt.item.actor === item.actor
      ) {
        run.push(nxt);
        j++;
      } else break;
    }
    out.push(mergeRun(run, item.flavor, item.actor, item.ts));
    i = j;
  }
  return out;
}

function mergeRun(
  run: Pending[],
  flavor: EventFlavor,
  actor: string | undefined,
  ts: string,
): ThreadEvent {
  if (run.length === 1) {
    const only = run[0]!;
    return { ...(only.item as ThreadEvent), text: phraseFor(actor, [only.batch!], flavor) };
  }
  const batches = run.map((p) => p.batch!);
  return event(ts, phraseFor(actor, batches, flavor), flavor, actor);
}

function phraseFor(
  actor: string | undefined,
  batches: Batchable[],
  flavor: EventFlavor,
): string {
  const who = actor ?? batches.find((b) => b.who)?.who ?? "someone";
  const collect = (verb: Batchable["verb"]) =>
    batches.filter((b) => b.verb === verb).map((b) => b.detail).filter(Boolean) as string[];

  if (flavor === "label") {
    const added = collect("added-label");
    const removed = collect("removed-label");
    const parts: string[] = [];
    if (added.length) parts.push(`added the ${plural("label", added.length)}: ${list(added)}`);
    if (removed.length) {
      parts.push(`removed the ${plural("label", removed.length)}: ${list(removed)}`);
    }
    if (!parts.length) parts.push("updated the labels");
    return `${who} ${parts.join(" and ")}`;
  }

  if (flavor === "assign") {
    const assigned = collect("assigned");
    const unassigned = collect("unassigned");
    const parts: string[] = [];
    if (assigned.length) parts.push(`assigned ${list(assigned)}`);
    if (unassigned.length) parts.push(`unassigned ${list(unassigned)}`);
    if (!parts.length) parts.push("changed the assignees");
    return `${who} ${parts.join(" and ")}`;
  }

  // commits
  const subjects = collect("committed");
  const n = batches.length;
  if (n === 1 && subjects[0]) return `${who} pushed a commit: “${subjects[0]}”`;
  return `${who} pushed ${n} ${plural("commit", n)}`;
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

function list(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
