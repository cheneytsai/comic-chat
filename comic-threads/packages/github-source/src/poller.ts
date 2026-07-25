/**
 * ThreadPoller — live updates without a backend (DESIGN.md F8, §2 "Real-time").
 *
 * GitHub has no browser push channel, so we poll with conditional requests:
 * a cheap `If-None-Match` probe against the issue and its newest comment.
 * A 304 costs nothing against the rate limit, so a 30 s cadence is safe even
 * unauthenticated. Only when a probe returns 200 do we re-fetch the whole
 * thread and diff it against the items we have already handed out.
 *
 * Zero dependencies, `fetch`-based: runs in Node and the browser alike.
 */

import type { Thread, ThreadItem } from "@comic-threads/core";
import {
  API_BASE,
  fetchThread,
  ghHeaders,
  rateLimitResetMs,
  type FetchLike,
  type FetchRef,
} from "./fetch.js";

export const DEFAULT_INTERVAL_MS = 30_000;
/** Floor applied when a rate-limit reset header is missing or in the past. */
export const RATE_LIMIT_FALLBACK_MS = 60_000;

export type PollerStatus = "idle" | "polling" | "rate-limited" | "stopped" | "error";

export interface PollOptions {
  intervalMs?: number;
  token?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  /** Seed the baseline so the first tick only reports genuinely new items. */
  initialThread?: Thread;
  /** If true and no `initialThread`, the first fetch is emitted wholesale. */
  emitInitial?: boolean;
  /** Non-fatal fetch failures are reported here rather than thrown. */
  onError?: (err: unknown) => void;
  /** Called whenever the full thread is re-fetched (state/title may change). */
  onThread?: (thread: Thread) => void;
  /** Injectable clock/timers for deterministic tests. */
  now?: () => number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

export type OnAppend = (items: ThreadItem[], thread: Thread) => void;

export interface TickResult {
  /** "unchanged" = both probes 304'd; nothing was re-fetched. */
  outcome: "unchanged" | "updated" | "rate-limited" | "error" | "stopped";
  newItems: ThreadItem[];
  thread?: Thread;
  /** epoch ms the poller will stay quiet until, when rate-limited. */
  retryAt?: number;
}

/**
 * Stable identity for a thread item. The REST model has ids, but the `Thread`
 * model is source-agnostic and deliberately does not, so identity is derived
 * from the content that would have to change for it to be a different beat.
 */
export function itemKey(item: ThreadItem): string {
  if (item.kind === "utterance") {
    const code = (item.codeBlocks ?? []).length;
    return `u|${item.author}|${item.ts}|${item.mode}|${code}|${item.body}`;
  }
  return `e|${item.flavor}|${item.ts}|${item.actor ?? ""}|${item.text}`;
}

export class ThreadPoller {
  private timer: unknown = undefined;
  private stopped = false;
  private running = false;
  private seen = new Set<string>();
  private etags = new Map<string, string>();
  /** True until the first successful fetch, which is absorbed as the baseline. */
  private needsBaseline = true;
  private opts: Required<Pick<PollOptions, "intervalMs">> & PollOptions = {
    intervalMs: DEFAULT_INTERVAL_MS,
  };
  private ref?: FetchRef;
  private onAppend?: OnAppend;
  private _status: PollerStatus = "idle";
  private _rateLimitedUntil = 0;

  get status(): PollerStatus {
    return this._status;
  }

  /** Epoch ms until which polling is suspended due to a 403 rate limit (0 = not). */
  get rateLimitedUntil(): number {
    return this._rateLimitedUntil;
  }

  /**
   * Start polling `ref`. `onAppend` receives only items not previously seen.
   * Returns `this` so callers can `const p = new ThreadPoller().poll(...)`.
   */
  poll(ref: FetchRef, onAppend: OnAppend, options: PollOptions = {}): this {
    this.stop();
    this.stopped = false;
    this.ref = ref;
    this.onAppend = onAppend;
    this.opts = { ...options, intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS };
    this.seen = new Set<string>();
    this.etags = new Map<string, string>();
    this._rateLimitedUntil = 0;
    this._status = "polling";

    if (options.initialThread) {
      for (const item of options.initialThread.items) this.seen.add(itemKey(item));
      this.needsBaseline = false;
    } else {
      // Without a seed the first fetch establishes the baseline silently,
      // unless the caller explicitly asked to receive it.
      this.needsBaseline = !options.emitInitial;
    }

    this.schedule(this.opts.intervalMs ?? DEFAULT_INTERVAL_MS);
    return this;
  }

  /** Cancels the pending timer; in-flight results are discarded. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      (this.opts.clearTimeoutImpl ?? defaultClearTimeout)(this.timer);
      this.timer = undefined;
    }
    if (this._status !== "idle") this._status = "stopped";
  }

  /**
   * Runs one poll cycle immediately. Exposed for a manual "refresh now" button
   * and for tests; the scheduled loop calls the same code path.
   */
  async tick(): Promise<TickResult> {
    if (!this.ref || !this.onAppend) return { outcome: "stopped", newItems: [] };
    if (this.running) return { outcome: "unchanged", newItems: [] };
    this.running = true;
    try {
      return await this.runTick();
    } finally {
      this.running = false;
    }
  }

  private async runTick(): Promise<TickResult> {
    const ref = this.ref!;
    const now = this.opts.now ?? Date.now;
    if (this._rateLimitedUntil > now()) {
      return { outcome: "rate-limited", newItems: [], retryAt: this._rateLimitedUntil };
    }

    let changed: boolean;
    try {
      changed = await this.probe(ref);
    } catch (err) {
      if (err instanceof RateLimited) {
        this._rateLimitedUntil = err.retryAt;
        this._status = "rate-limited";
        return { outcome: "rate-limited", newItems: [], retryAt: err.retryAt };
      }
      this._status = "error";
      this.opts.onError?.(err);
      return { outcome: "error", newItems: [] };
    }

    if (!changed) {
      this._status = "polling";
      return { outcome: "unchanged", newItems: [] };
    }

    let thread: Thread;
    try {
      thread = await fetchThread(ref, {
        token: this.opts.token,
        fetchImpl: this.opts.fetchImpl,
        baseUrl: this.opts.baseUrl,
      });
    } catch (err) {
      const reset = retryAtFor(err, now());
      if (reset !== undefined) {
        this._rateLimitedUntil = reset;
        this._status = "rate-limited";
        return { outcome: "rate-limited", newItems: [], retryAt: reset };
      }
      this._status = "error";
      this.opts.onError?.(err);
      return { outcome: "error", newItems: [] };
    }

    if (this.stopped) return { outcome: "stopped", newItems: [] };

    const baselining = this.needsBaseline;
    this.needsBaseline = false;
    const newItems: ThreadItem[] = [];
    for (const item of thread.items) {
      const key = itemKey(item);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      if (!baselining) newItems.push(item);
    }

    this._status = "polling";
    this.opts.onThread?.(thread);
    if (newItems.length > 0) this.onAppend!(newItems, thread);
    return { outcome: "updated", newItems, thread };
  }

  /**
   * Conditional-GETs the issue and its newest comment. Returns true if either
   * responded 200 (something moved), false if both 304'd.
   */
  private async probe(ref: FetchRef): Promise<boolean> {
    const base = this.opts.baseUrl ?? API_BASE;
    const issueUrl = `${base}/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
    const commentsUrl = `${issueUrl}/comments?per_page=1&sort=created&direction=desc`;

    const results = await Promise.all([
      this.conditionalGet(issueUrl),
      this.conditionalGet(commentsUrl),
    ]);
    return results.some(Boolean);
  }

  private async conditionalGet(url: string): Promise<boolean> {
    const doFetch = resolveFetch(this.opts.fetchImpl);
    const headers = ghHeaders(this.opts.token);
    const etag = this.etags.get(url);
    if (etag) headers["If-None-Match"] = etag;

    const res = await doFetch(url, { headers });
    if (res.status === 304) return false;

    if (res.status === 403 || res.status === 429) {
      const now = (this.opts.now ?? Date.now)();
      throw new RateLimited(backoffTarget(res, now), url);
    }
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);

    const fresh = res.headers.get("etag");
    if (fresh) this.etags.set(url, fresh);
    else this.etags.delete(url);
    return true;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    const set = this.opts.setTimeoutImpl ?? defaultSetTimeout;
    this.timer = set(() => {
      void this.loop();
    }, ms);
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    const result = await this.tick();
    if (this.stopped) return;
    const now = (this.opts.now ?? Date.now)();
    const interval = this.opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    const wait =
      result.outcome === "rate-limited" && result.retryAt
        ? Math.max(result.retryAt - now, 1_000)
        : interval;
    this.schedule(wait);
  }
}

class RateLimited extends Error {
  constructor(
    readonly retryAt: number,
    readonly url: string,
  ) {
    super(`GitHub rate limit; retry at ${new Date(retryAt).toISOString()}`);
    this.name = "RateLimited";
  }
}

/** Honors `retry-after` (seconds) then `x-ratelimit-reset` (epoch seconds). */
export function backoffTarget(res: { headers: Headers }, now: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return now + retryAfter * 1000;
  const reset = rateLimitResetMs(res);
  if (reset !== undefined && reset > now) return reset;
  return now + RATE_LIMIT_FALLBACK_MS;
}

function retryAtFor(err: unknown, now: number): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { status?: number; rateLimitReset?: number };
  if (e.status !== 403 && e.status !== 429) return undefined;
  return e.rateLimitReset !== undefined && e.rateLimitReset > now
    ? e.rateLimitReset
    : now + RATE_LIMIT_FALLBACK_MS;
}

function resolveFetch(impl?: FetchLike): FetchLike {
  if (impl) return impl;
  const g = globalThis.fetch;
  if (!g) throw new Error("No global fetch available; pass fetchImpl");
  return ((input, init) => g(input, init as RequestInit)) as FetchLike;
}

function defaultSetTimeout(fn: () => void, ms: number): unknown {
  return setTimeout(fn, ms);
}

function defaultClearTimeout(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}
