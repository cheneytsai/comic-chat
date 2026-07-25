/**
 * @comic-threads/github-source — the GitHub adapter: parse a thread URL,
 * fetch and normalize an issue/PR into core's `Thread`, and keep it live with
 * ETag conditional polling. No dependencies beyond `fetch`; runs in Node and
 * the browser.
 *
 *   const ref = parseThreadUrl("https://github.com/acme/ui/pull/42")!;
 *   const thread = await fetchThread(ref, { token });
 *   const poller = new ThreadPoller().poll(ref, (items) => append(items), {
 *     initialThread: thread, token,
 *   });
 *   // …later: poller.stop();
 */

export { parseThreadUrl, refId, threadHtmlUrl, type ThreadRef } from "./url.js";

export {
  fetchThread,
  normalizeThread,
  extractCodeBlocks,
  summarizeBotBody,
  isBotLogin,
  codePlaceholder,
  ghHeaders,
  rateLimitResetMs,
  nextLink,
  GitHubFetchError,
  API_BASE,
  BOT_SUMMARY_THRESHOLD,
  CODE_PLACEHOLDER_RE,
  type FetchRef,
  type FetchLike,
  type FetchThreadOptions,
  type RawThreadData,
} from "./fetch.js";

export {
  ThreadPoller,
  itemKey,
  backoffTarget,
  DEFAULT_INTERVAL_MS,
  RATE_LIMIT_FALLBACK_MS,
  type PollOptions,
  type PollerStatus,
  type OnAppend,
  type TickResult,
} from "./poller.js";

export type * from "./apiTypes.js";
