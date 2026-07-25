/**
 * A tiny recorded-response GitHub API stub. api.github.com is unreachable from
 * the test sandbox (and we do not want tests burning rate limit anyway), so
 * every test drives `fetchThread`/`ThreadPoller` through this instead.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TEST_BASE = "https://api.github.test";

export function fixture<T>(name: string): T {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

export interface Route {
  /** Matched against the request URL with `startsWith` on the path+query. */
  url: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface MockFetch {
  (input: string, init?: { headers?: Record<string, string> }): Promise<Response>;
  /** Every request URL seen, in order. */
  calls: string[];
  /** Every request's headers, in order. */
  headers: Array<Record<string, string>>;
  /** Swap the routing table mid-test (e.g. to simulate a new comment). */
  setRoutes(routes: Route[]): void;
}

export function makeFetch(routes: Route[]): MockFetch {
  let table = routes;
  const fn = (async (input: string, init?: { headers?: Record<string, string> }) => {
    fn.calls.push(input);
    fn.headers.push(init?.headers ?? {});
    const route = pick(table, input, init?.headers);
    if (!route) {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const status = route.status ?? 200;
    const headers = new Headers({ "content-type": "application/json", ...route.headers });
    const body = status === 304 || route.body === undefined ? null : JSON.stringify(route.body);
    return new Response(body, { status, headers });
  }) as MockFetch;
  fn.calls = [];
  fn.headers = [];
  fn.setRoutes = (r: Route[]) => {
    table = r;
  };
  return fn;
}

/**
 * Exact-match first, then longest prefix match, so `/issues/42` and
 * `/issues/42/comments` can coexist. A route whose `headers` include an etag
 * only matches when the request's `If-None-Match` matches it.
 */
function pick(
  table: Route[],
  url: string,
  reqHeaders?: Record<string, string>,
): Route | undefined {
  const candidates = table.filter((r) => url === r.url || url.startsWith(r.url));
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.url.length - a.url.length);
  const best = candidates[0]!;
  const sameLen = candidates.filter((r) => r.url.length === best.url.length);
  if (sameLen.length > 1) {
    // Conditional variants of the same URL: prefer the one whose expectation
    // about If-None-Match is satisfied.
    const inm = reqHeaders?.["If-None-Match"];
    const conditional = sameLen.find((r) => r.status === 304);
    const unconditional = sameLen.find((r) => r.status !== 304);
    if (inm && conditional) return conditional;
    return unconditional ?? best;
  }
  return best;
}

/** The route table for the recorded PR #42 (a merged pull request). */
export function prRoutes(base = TEST_BASE): Route[] {
  const issue = `${base}/repos/acme/disco-ui/issues/42`;
  const pull = `${base}/repos/acme/disco-ui/pulls/42`;
  return [
    { url: issue, body: fixture("pr-issue"), headers: { etag: 'W/"issue-v1"' } },
    {
      url: `${issue}/comments`,
      body: fixture("pr-comments-1"),
      headers: {
        etag: 'W/"comments-v1"',
        link: `<${issue}/comments?per_page=100&page=2>; rel="next", <${issue}/comments?per_page=100&page=2>; rel="last"`,
      },
    },
    { url: `${issue}/comments?per_page=100&page=2`, body: fixture("pr-comments-2") },
    { url: `${issue}/timeline`, body: fixture("pr-timeline") },
    { url: `${pull}/reviews`, body: fixture("pr-reviews") },
    { url: `${pull}/comments`, body: fixture("pr-review-comments") },
  ];
}

/** The route table for the recorded issue #7 (closed, not merged). */
export function issueRoutes(base = TEST_BASE): Route[] {
  const issue = `${base}/repos/acme/disco-ui/issues/7`;
  return [
    { url: issue, body: fixture("issue-issue") },
    { url: `${issue}/comments`, body: fixture("issue-comments") },
    { url: `${issue}/timeline`, body: fixture("issue-timeline") },
  ];
}
