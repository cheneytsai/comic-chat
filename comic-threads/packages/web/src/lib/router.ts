/**
 * Hash routing (F10) — `#/gh/{owner}/{repo}/issues/{n}` and `.../pull/{n}`,
 * plus `#/demo` for the bundled fixture. Hash routes keep the app deployable
 * as plain static files (GitHub Pages) with no server rewrites.
 */

import type { ThreadRef } from "@comic-threads/github-source";

export type Route =
  | { view: "landing" }
  | { view: "demo" }
  | { view: "thread"; ref: ThreadRef };

const ROUTE_RE = /^#?\/gh\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\/?$/;

export function parseRoute(hash: string): Route {
  const raw = hash || "";
  if (raw === "" || raw === "#" || raw === "#/") return { view: "landing" };
  if (raw === "#/demo" || raw === "#/demo/") return { view: "demo" };
  const m = ROUTE_RE.exec(raw);
  if (m) {
    return {
      view: "thread",
      ref: {
        owner: decodeURIComponent(m[1]!),
        repo: decodeURIComponent(m[2]!),
        number: Number(m[4]),
        type: m[3] === "pull" ? "pull" : "issues",
      },
    };
  }
  return { view: "landing" };
}

export function routeHash(route: Route): string {
  if (route.view === "landing") return "#/";
  if (route.view === "demo") return "#/demo";
  const { owner, repo, number, type } = route.ref;
  const seg = type === "pull" ? "pull" : "issues";
  return `#/gh/${owner}/${repo}/${seg}/${number}`;
}

export function navigate(route: Route): void {
  const next = routeHash(route);
  if (globalThis.location.hash !== next) globalThis.location.hash = next;
}

export function currentRoute(): Route {
  return parseRoute(globalThis.location.hash);
}
