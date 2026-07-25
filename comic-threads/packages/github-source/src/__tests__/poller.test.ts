import { describe, expect, it, vi } from "vitest";
import type { Thread, ThreadItem } from "@comic-threads/core";
import { fetchThread, type FetchLike } from "../fetch.js";
import {
  backoffTarget,
  DEFAULT_INTERVAL_MS,
  itemKey,
  RATE_LIMIT_FALLBACK_MS,
  ThreadPoller,
} from "../poller.js";
import { fixture, makeFetch, prRoutes, TEST_BASE, type Route } from "./mockFetch.js";

const REF = { owner: "acme", repo: "disco-ui", number: 42 };
const ISSUE_URL = `${TEST_BASE}/repos/acme/disco-ui/issues/42`;

/** A timer stub: nothing fires unless the test says so. */
function timerStub() {
  const queue: Array<() => void> = [];
  const cleared: unknown[] = [];
  return {
    queue,
    cleared,
    setTimeoutImpl: (fn: () => void, _ms: number) => {
      queue.push(fn);
      return queue.length;
    },
    clearTimeoutImpl: (handle: unknown) => {
      cleared.push(handle);
    },
    delays: [] as number[],
  };
}

function recordingTimer() {
  const t = timerStub();
  const set = (fn: () => void, ms: number) => {
    t.delays.push(ms);
    return t.setTimeoutImpl(fn, ms);
  };
  return { ...t, setTimeoutImpl: set };
}

async function baselineThread(): Promise<Thread> {
  const f = makeFetch(prRoutes());
  return fetchThread(REF, { fetchImpl: f as unknown as FetchLike, baseUrl: TEST_BASE });
}

/** 304 variants layered on top of the recorded 200 routes. */
function conditionalRoutes(): Route[] {
  return [
    ...prRoutes(),
    { url: ISSUE_URL, status: 304 },
    { url: `${ISSUE_URL}/comments`, status: 304 },
  ];
}

describe("ThreadPoller — conditional requests", () => {
  it("no-ops when both probes return 304, without re-fetching the thread", async () => {
    const fetchImpl = makeFetch([
      { url: ISSUE_URL, status: 304 },
      { url: `${ISSUE_URL}/comments`, status: 304 },
    ]);
    const timers = timerStub();
    const onAppend = vi.fn();
    const poller = new ThreadPoller().poll(REF, onAppend, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      initialThread: await baselineThread(),
      ...timers,
    });

    const result = await poller.tick();
    expect(result.outcome).toBe("unchanged");
    expect(result.newItems).toEqual([]);
    expect(onAppend).not.toHaveBeenCalled();
    // Exactly the two cheap probes — no comments/timeline/reviews traffic.
    expect(fetchImpl.calls).toHaveLength(2);
    expect(poller.status).toBe("polling");
    poller.stop();
  });

  it("stores the ETag and sends it back as If-None-Match", async () => {
    const fetchImpl = makeFetch(conditionalRoutes());
    const timers = timerStub();
    const poller = new ThreadPoller().poll(REF, vi.fn(), {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      initialThread: await baselineThread(),
      ...timers,
    });

    const first = await poller.tick();
    expect(first.outcome).toBe("updated");
    expect(fetchImpl.headers[0]!["If-None-Match"]).toBeUndefined();

    fetchImpl.calls.length = 0;
    fetchImpl.headers.length = 0;

    const second = await poller.tick();
    expect(second.outcome).toBe("unchanged");
    expect(fetchImpl.headers[0]!["If-None-Match"]).toBe('W/"issue-v1"');
    expect(fetchImpl.headers[1]!["If-None-Match"]).toBe('W/"comments-v1"');
    expect(fetchImpl.calls).toHaveLength(2);
    poller.stop();
  });
});

describe("ThreadPoller — diffing", () => {
  it("appends only items it has not already handed out", async () => {
    const initialThread = await baselineThread();
    const fetchImpl = makeFetch(prRoutes());
    const timers = timerStub();
    const appended: ThreadItem[][] = [];
    const onThread = vi.fn();

    const poller = new ThreadPoller().poll(REF, (items) => appended.push(items), {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      initialThread,
      onThread,
      ...timers,
    });

    // Nothing new yet: the probe 200s (no etags in this table) but the diff is empty.
    const unchanged = await poller.tick();
    expect(unchanged.outcome).toBe("updated");
    expect(unchanged.newItems).toEqual([]);
    expect(appended).toHaveLength(0);
    expect(onThread).toHaveBeenCalledTimes(1);

    // A new comment lands.
    const page2 = fixture<Array<Record<string, unknown>>>("pr-comments-2");
    page2.push({
      id: 1005,
      user: { login: "newbie42", type: "User" },
      body: "wait it is fixed?!",
      created_at: "2026-07-10T09:50:00Z",
      author_association: "NONE",
    });
    fetchImpl.setRoutes([
      ...prRoutes().filter((r) => !r.url.endsWith("page=2")),
      { url: `${ISSUE_URL}/comments?per_page=100&page=2`, body: page2 },
    ]);

    const updated = await poller.tick();
    expect(updated.outcome).toBe("updated");
    expect(updated.newItems).toHaveLength(1);
    expect(updated.newItems[0]).toMatchObject({
      kind: "utterance",
      author: "newbie42",
      body: "wait it is fixed?!",
    });
    expect(appended).toEqual([updated.newItems]);

    // And it is not re-announced on the next cycle.
    const again = await poller.tick();
    expect(again.newItems).toEqual([]);
    expect(appended).toHaveLength(1);
    poller.stop();
  });

  it("absorbs the first fetch as a baseline when no initial thread is given", async () => {
    const fetchImpl = makeFetch(prRoutes());
    const timers = timerStub();
    const onAppend = vi.fn();
    const poller = new ThreadPoller().poll(REF, onAppend, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      ...timers,
    });

    const first = await poller.tick();
    expect(first.outcome).toBe("updated");
    expect(first.newItems).toEqual([]);
    expect(onAppend).not.toHaveBeenCalled();
    poller.stop();
  });

  it("emits the whole thread on the first tick when emitInitial is set", async () => {
    const fetchImpl = makeFetch(prRoutes());
    const timers = timerStub();
    const onAppend = vi.fn();
    const poller = new ThreadPoller().poll(REF, onAppend, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      emitInitial: true,
      ...timers,
    });

    const first = await poller.tick();
    expect(first.newItems.length).toBeGreaterThan(5);
    expect(onAppend).toHaveBeenCalledOnce();
    poller.stop();
  });

  it("derives a stable key per item", () => {
    const a: ThreadItem = {
      kind: "utterance",
      author: "octocat",
      body: "hi",
      ts: "2026-07-10T09:00:00Z",
      mode: "say",
    };
    expect(itemKey(a)).toBe(itemKey({ ...a }));
    expect(itemKey(a)).not.toBe(itemKey({ ...a, body: "hi!" }));
    expect(itemKey(a)).not.toBe(itemKey({ ...a, mode: "whisper" }));
  });
});

describe("ThreadPoller — rate limiting", () => {
  const RESET_SECONDS = 1_800_000_000;

  function rateLimitedFetch() {
    return makeFetch([
      {
        url: ISSUE_URL,
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(RESET_SECONDS),
        },
      },
      { url: `${ISSUE_URL}/comments`, status: 304 },
    ]);
  }

  it("backs off until x-ratelimit-reset and stops hammering the API", async () => {
    const fetchImpl = rateLimitedFetch();
    const timers = timerStub();
    let now = RESET_SECONDS * 1000 - 120_000;
    const onError = vi.fn();

    const poller = new ThreadPoller().poll(REF, vi.fn(), {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      initialThread: await baselineThread(),
      now: () => now,
      onError,
      ...timers,
    });

    const first = await poller.tick();
    expect(first.outcome).toBe("rate-limited");
    expect(first.retryAt).toBe(RESET_SECONDS * 1000);
    expect(poller.status).toBe("rate-limited");
    expect(poller.rateLimitedUntil).toBe(RESET_SECONDS * 1000);
    // A 403 is not an "error" the UI should surface as broken.
    expect(onError).not.toHaveBeenCalled();

    const callsAfterFirst = fetchImpl.calls.length;
    const second = await poller.tick();
    expect(second.outcome).toBe("rate-limited");
    // Short-circuited: no request was made at all while suspended.
    expect(fetchImpl.calls).toHaveLength(callsAfterFirst);

    // Once the window resets, polling resumes.
    now = RESET_SECONDS * 1000 + 1;
    fetchImpl.setRoutes([
      { url: ISSUE_URL, status: 304 },
      { url: `${ISSUE_URL}/comments`, status: 304 },
    ]);
    const third = await poller.tick();
    expect(third.outcome).toBe("unchanged");
    expect(fetchImpl.calls.length).toBeGreaterThan(callsAfterFirst);
    poller.stop();
  });

  it("reschedules the next cycle for the reset time, not the interval", async () => {
    const fetchImpl = rateLimitedFetch();
    const timers = recordingTimer();
    const now = RESET_SECONDS * 1000 - 120_000;

    const poller = new ThreadPoller().poll(REF, vi.fn(), {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      initialThread: await baselineThread(),
      intervalMs: 30_000,
      now: () => now,
      ...timers,
    });
    expect(timers.delays).toEqual([30_000]);

    timers.queue.shift()!();
    await vi.waitFor(() => expect(timers.delays).toHaveLength(2));
    expect(timers.delays[1]).toBe(120_000);
    poller.stop();
  });

  it("prefers retry-after, then x-ratelimit-reset, then a fixed floor", () => {
    const now = 1_000_000;
    const res = (h: Record<string, string>) => ({ headers: new Headers(h) });
    expect(backoffTarget(res({ "retry-after": "42" }), now)).toBe(now + 42_000);
    expect(backoffTarget(res({ "x-ratelimit-reset": "2000" }), now)).toBe(2_000_000);
    // A reset already in the past must not produce an immediate retry.
    expect(backoffTarget(res({ "x-ratelimit-reset": "1" }), now)).toBe(now + RATE_LIMIT_FALLBACK_MS);
    expect(backoffTarget(res({}), now)).toBe(now + RATE_LIMIT_FALLBACK_MS);
  });
});

describe("ThreadPoller — lifecycle", () => {
  it("schedules on the default interval and cancels on stop()", async () => {
    const fetchImpl = makeFetch(conditionalRoutes());
    const timers = recordingTimer();
    const poller = new ThreadPoller().poll(REF, vi.fn(), {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      initialThread: await baselineThread(),
      ...timers,
    });

    expect(timers.delays).toEqual([DEFAULT_INTERVAL_MS]);
    poller.stop();
    expect(timers.cleared).toHaveLength(1);
    expect(poller.status).toBe("stopped");

    // A fired-but-cancelled callback must not reschedule or re-fetch.
    const before = fetchImpl.calls.length;
    timers.queue.shift()!();
    await Promise.resolve();
    expect(timers.delays).toHaveLength(1);
    expect(fetchImpl.calls).toHaveLength(before);
  });

  it("keeps polling on the interval after an unchanged cycle", async () => {
    const fetchImpl = makeFetch([
      { url: ISSUE_URL, status: 304 },
      { url: `${ISSUE_URL}/comments`, status: 304 },
    ]);
    const timers = recordingTimer();
    const poller = new ThreadPoller().poll(REF, vi.fn(), {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
      intervalMs: 5_000,
      initialThread: await baselineThread(),
      ...timers,
    });

    timers.queue.shift()!();
    await vi.waitFor(() => expect(timers.delays).toEqual([5_000, 5_000]));
    poller.stop();
  });

  it("reports transport failures via onError without throwing", async () => {
    const failing = (() => Promise.reject(new Error("offline"))) as unknown as FetchLike;
    const timers = timerStub();
    const onError = vi.fn();
    const poller = new ThreadPoller().poll(REF, vi.fn(), {
      fetchImpl: failing,
      baseUrl: TEST_BASE,
      initialThread: await baselineThread(),
      onError,
      ...timers,
    });

    const result = await poller.tick();
    expect(result.outcome).toBe("error");
    expect(onError).toHaveBeenCalledOnce();
    expect(poller.status).toBe("error");
    poller.stop();
  });
});
