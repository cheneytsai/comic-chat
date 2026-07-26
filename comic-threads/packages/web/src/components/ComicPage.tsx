/**
 * The comic view: header (title, state, cast, live indicator), the strip, and
 * the live poller. Works from two sources — the bundled demo fixture (no
 * network beyond this app's own static files) and a real GitHub thread.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Comic, Thread, ThreadItem } from "@comic-threads/core";
import {
  ThreadPoller,
  fetchThread,
  threadHtmlUrl,
  type PollerStatus,
  type ThreadRef,
} from "@comic-threads/github-source";
import { assetUrl } from "../lib/assets.js";
import { composeComic } from "../lib/comic.js";
import {
  loadOverrides,
  repoKeyFromThreadId,
  setOverride,
  type CastOverrides,
} from "../lib/casting.js";
import { classifyError, type LoadError } from "../lib/errors.js";
import { loadRosterIndex, type RosterIndex } from "../lib/roster.js";
import type { Settings } from "../lib/settings.js";
import { CastStrip } from "./CastStrip.js";
import { ComicStrip } from "./ComicStrip.js";
import { LiveChip, StateChip, type LiveState } from "./StateChip.js";
import { navigate } from "../lib/router.js";

export type ComicSource = { kind: "demo" } | { kind: "github"; ref: ThreadRef };

export interface ComicPageProps {
  source: ComicSource;
  settings: Settings;
  onOpenSettings: () => void;
  onToggleAutoScroll: (value: boolean) => void;
}

interface Loaded {
  thread: Thread;
  comic: Comic;
  casting: Map<string, string>;
}

function sourceKey(source: ComicSource): string {
  return source.kind === "demo"
    ? "demo"
    : `${source.ref.owner}/${source.ref.repo}/${source.ref.type}/${source.ref.number}`;
}

async function loadDemoThread(): Promise<Thread> {
  const res = await fetch(assetUrl("fixtures/demo-thread.json"));
  if (!res.ok) throw new Error(`demo fixture: HTTP ${res.status}`);
  return (await res.json()) as Thread;
}

export function ComicPage({
  source,
  settings,
  onOpenSettings,
  onToggleAutoScroll,
}: ComicPageProps): preact.JSX.Element {
  const key = sourceKey(source);
  const [index, setIndex] = useState<RosterIndex | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [busy, setBusy] = useState(true);
  const [freshFrom, setFreshFrom] = useState(Number.POSITIVE_INFINITY);
  const [live, setLive] = useState<LiveState>(source.kind === "demo" ? "offline" : "idle");
  const [overrides, setOverrides] = useState<CastOverrides>({});
  const [reloadNonce, setReloadNonce] = useState(0);

  const pollerRef = useRef<ThreadPoller | null>(null);
  const panelCountRef = useRef(0);
  const aliveRef = useRef(true);

  panelCountRef.current = loaded?.comic.panels.length ?? 0;

  // --- roster index ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    loadRosterIndex().then(
      (idx) => {
        if (!cancelled) setIndex(idx);
      },
      (err: unknown) => {
        if (!cancelled) {
          setError(classifyError(err));
          setBusy(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // --- thread load + poller -------------------------------------------------
  useEffect(() => {
    if (!index) return;
    aliveRef.current = true;
    setBusy(true);
    setError(null);
    setLoaded(null);
    setFreshFrom(Number.POSITIVE_INFINITY);

    const abort = new AbortController();
    let poller: ThreadPoller | null = null;

    const run = async (): Promise<void> => {
      try {
        const thread =
          source.kind === "demo"
            ? await loadDemoThread()
            : await fetchThread(source.ref, { token: settings.token || undefined, signal: abort.signal });
        if (!aliveRef.current) return;

        const repoKey = repoKeyFromThreadId(thread.id);
        const initialOverrides = loadOverrides(repoKey);
        setOverrides(initialOverrides);

        const composed = await composeComic(thread, index, initialOverrides);
        if (!aliveRef.current) return;
        setLoaded({ thread, ...composed });
        setBusy(false);

        if (source.kind === "github") {
          poller = new ThreadPoller();
          pollerRef.current = poller;
          setLive("polling");
          poller.poll(
            source.ref,
            (_items: ThreadItem[], updated: Thread) => {
              if (!aliveRef.current) return;
              // Panel breaks depend on neighbouring items, so recompose from
              // the whole thread rather than appending in isolation.
              const before = panelCountRef.current;
              void composeComic(updated, index, loadOverrides(repoKeyFromThreadId(updated.id))).then(
                (next) => {
                  if (!aliveRef.current) return;
                  setFreshFrom(before);
                  setLoaded({ thread: updated, ...next });
                },
              );
            },
            {
              initialThread: thread,
              intervalMs: settings.pollIntervalMs,
              token: settings.token || undefined,
              onThread: (t) => {
                if (aliveRef.current) setLoaded((cur) => (cur ? { ...cur, thread: t } : cur));
              },
              onError: () => {
                /* status chip reflects it; transient failures are not fatal */
              },
            },
          );
        }
      } catch (err) {
        if (!aliveRef.current || abort.signal.aborted) return;
        setError(classifyError(err));
        setBusy(false);
        setLive("error");
      }
    };

    void run();

    return () => {
      aliveRef.current = false;
      abort.abort();
      poller?.stop();
      pollerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, key, settings.token, settings.pollIntervalMs, reloadNonce]);

  // --- mirror poller status into the LIVE chip ------------------------------
  useEffect(() => {
    if (source.kind === "demo") {
      setLive("offline");
      return;
    }
    const timer = globalThis.setInterval(() => {
      const p = pollerRef.current;
      if (!p) return;
      // PollerStatus is a subset of LiveState ("offline" is demo-only).
      const status: PollerStatus = p.status;
      setLive(status);
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [key, source.kind]);

  // --- re-casting -----------------------------------------------------------
  const recast = useCallback(
    (login: string, character: string | null) => {
      if (!index || !loaded) return;
      const repoKey = repoKeyFromThreadId(loaded.thread.id);
      const next = setOverride(repoKey, overrides, login, character);
      setOverrides(next);
      void composeComic(loaded.thread, index, next).then((composed) => {
        if (!aliveRef.current) return;
        setFreshFrom(Number.POSITIVE_INFINITY);
        setLoaded({ thread: loaded.thread, ...composed });
      });
    },
    [index, loaded, overrides],
  );

  const githubUrl = useMemo(() => {
    if (loaded) return loaded.thread.url;
    if (source.kind === "github") return threadHtmlUrl(source.ref, source.ref.type === "pull");
    return "https://github.com";
  }, [loaded, source]);

  const heading =
    loaded?.thread.title ??
    (source.kind === "github"
      ? `${source.ref.owner}/${source.ref.repo} #${source.ref.number}`
      : "Demo thread");

  return (
    <div class="comic-page">
      <header class="comic-header">
        <div class="comic-header-top">
          <button type="button" class="wordmark-sm" onClick={() => navigate({ view: "landing" })}>
            <span class="wordmark-bubble">🗨</span> Comic Threads
          </button>
          <div class="comic-header-tools">
            <LiveChip state={live} />
            <label class="toggle" title="Scroll to the newest panel when the thread updates">
              <input
                type="checkbox"
                checked={settings.autoScroll}
                onChange={(e) => onToggleAutoScroll((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>auto-scroll</span>
            </label>
            <button type="button" class="ghost-btn" onClick={onOpenSettings}>
              ⚙ Settings
            </button>
            <a class="primary-btn" href={githubUrl} target="_blank" rel="noreferrer noopener">
              Reply on GitHub ↗
            </a>
          </div>
        </div>

        <h1 class="comic-title">
          {heading}
          {loaded ? <StateChip state={loaded.thread.state} /> : null}
        </h1>
        <p class="comic-sub">
          {loaded ? (
            <>
              <span class="mono">{loaded.thread.id}</span> · {loaded.comic.panels.length} panels ·{" "}
              {loaded.thread.participants.length} in the cast
            </>
          ) : error ? (
            "Nothing to draw."
          ) : (
            "Loading…"
          )}
        </p>

        {loaded && index ? (
          <CastStrip
            participants={loaded.thread.participants}
            casting={loaded.casting}
            roster={index.characters}
            overrides={overrides}
            onRecast={recast}
          />
        ) : null}
      </header>

      {error ? (
        <div class={`error-card error-${error.kind}`} role="alert">
          <h2>{error.title}</h2>
          <p>{error.detail}</p>
          <div class="error-actions">
            <button type="button" class="primary-btn" onClick={() => setReloadNonce((n) => n + 1)}>
              Try again
            </button>
            {error.suggestToken ? (
              <button type="button" class="ghost-btn" onClick={onOpenSettings}>
                Add a token
              </button>
            ) : null}
            <a class="ghost-btn" href={githubUrl} target="_blank" rel="noreferrer noopener">
              Open on GitHub ↗
            </a>
          </div>
        </div>
      ) : null}

      {busy && !error ? <div class="loading">Composing panels…</div> : null}

      {loaded ? (
        <ComicStrip
          comic={loaded.comic}
          freshFrom={freshFrom}
          autoScroll={settings.autoScroll}
        />
      ) : null}

      <footer class="comic-footer">
        Art and composition rules from Microsoft Comic Chat (1996), MIT-licensed. Unofficial
        homage; no Microsoft endorsement implied.
      </footer>
    </div>
  );
}
