/**
 * Parse GitHub issue/PR references into {owner, repo, number}. Accepts full
 * URLs (issues and pulls) and the `owner/repo#123` shorthand.
 */

export interface ThreadRef {
  owner: string;
  repo: string;
  number: number;
  /** best-effort hint; the fetcher confirms via the `pull_request` field. */
  type: "issues" | "pull" | "unknown";
}

const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?";
const REPO = "[A-Za-z0-9._-]+";

const URL_RE = new RegExp(
  `^https?://(?:www\\.)?github\\.com/(${OWNER})/(${REPO})/(issues|pull|pulls)/(\\d+)`,
  "i",
);
const SHORT_RE = new RegExp(`^(${OWNER})/(${REPO})#(\\d+)$`);
const API_RE = new RegExp(
  `^https?://api\\.github\\.com/repos/(${OWNER})/(${REPO})/(issues|pulls)/(\\d+)`,
  "i",
);

export function parseThreadUrl(input: string): ThreadRef | null {
  const raw = input.trim();

  const url = URL_RE.exec(raw);
  if (url) {
    return {
      owner: url[1]!,
      repo: url[2]!,
      number: Number(url[4]),
      type: url[3]!.toLowerCase().startsWith("pull") ? "pull" : "issues",
    };
  }

  const api = API_RE.exec(raw);
  if (api) {
    return {
      owner: api[1]!,
      repo: api[2]!,
      number: Number(api[4]),
      type: api[3]!.toLowerCase() === "pulls" ? "pull" : "issues",
    };
  }

  const short = SHORT_RE.exec(raw);
  if (short) {
    return { owner: short[1]!, repo: short[2]!, number: Number(short[3]), type: "unknown" };
  }

  return null;
}

export function refId(ref: ThreadRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

export function threadHtmlUrl(ref: ThreadRef, isPull: boolean): string {
  return `https://github.com/${ref.owner}/${ref.repo}/${isPull ? "pull" : "issues"}/${ref.number}`;
}
