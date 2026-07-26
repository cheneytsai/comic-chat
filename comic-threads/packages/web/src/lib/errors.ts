/**
 * Fetch failures, classified into the states the UI actually has copy for
 * (DESIGN.md F1/F11): rate limit → offer a PAT; 404 → not found; anything else
 * network-ish → retry.
 */

import { GitHubFetchError } from "@comic-threads/github-source";

export type LoadErrorKind = "rate-limit" | "not-found" | "auth" | "network" | "unknown";

export interface LoadError {
  kind: LoadErrorKind;
  title: string;
  detail: string;
  /** epoch ms when a rate limit lifts, if the response told us. */
  retryAt?: number;
  /** true → offering a personal access token would plausibly help. */
  suggestToken: boolean;
}

function formatReset(retryAt?: number): string {
  if (!retryAt || !Number.isFinite(retryAt)) return "";
  const mins = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000));
  return ` The limit resets in about ${mins} minute${mins === 1 ? "" : "s"}.`;
}

export function classifyError(err: unknown): LoadError {
  if (err instanceof GitHubFetchError) {
    if (err.status === 403 || err.status === 429) {
      return {
        kind: "rate-limit",
        title: "GitHub rate limit reached",
        detail:
          `Anonymous requests are capped at 60 per hour.${formatReset(err.rateLimitReset)} ` +
          "Add a personal access token in Settings to raise the limit to 5,000/hour — " +
          "it is stored in your browser and only ever sent to api.github.com.",
        retryAt: err.rateLimitReset,
        suggestToken: true,
      };
    }
    if (err.status === 401) {
      return {
        kind: "auth",
        title: "Token rejected",
        detail:
          "GitHub refused the personal access token. Check it in Settings, or clear it to " +
          "browse public threads anonymously.",
        suggestToken: true,
      };
    }
    if (err.status === 404) {
      return {
        kind: "not-found",
        title: "Thread not found",
        detail:
          "No issue or pull request at that URL. If the repository is private, add a personal " +
          "access token with repo access in Settings.",
        suggestToken: true,
      };
    }
    return {
      kind: "unknown",
      title: `GitHub returned ${err.status}`,
      detail: err.message,
      suggestToken: false,
    };
  }
  if (err instanceof Error && /abort/i.test(err.name)) {
    return { kind: "network", title: "Request cancelled", detail: err.message, suggestToken: false };
  }
  return {
    kind: "network",
    title: "Could not reach GitHub",
    detail:
      err instanceof Error
        ? err.message
        : "The request failed before a response arrived. Check your connection and try again.",
    suggestToken: false,
  };
}
