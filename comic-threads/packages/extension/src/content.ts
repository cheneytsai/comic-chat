/**
 * Content script: a self-contained overlay, not a page skin. GitHub's DOM is
 * off-limits as a data source (see DESIGN.md §2 — that's the whole reason
 * this fetches via the REST API in the background worker instead of
 * scraping) and it is also not used for *placement*: rather than hunting for
 * a stable insertion point in a markup GitHub can restyle at any time, this
 * drops one fixed-position button in the corner and does everything else in
 * a full-screen overlay of its own. The only thing read from the page is
 * `location.href`, to notice which issue/PR is open and to hand off to a
 * "turbo:load" listener for GitHub's client-side navigation.
 */

import {
  parseThreadUrl,
  refId,
  threadHtmlUrl,
  ThreadPoller,
  type ThreadRef,
} from "@comic-threads/github-source";
import type { Comic, Thread } from "@comic-threads/core";
import { composeComic } from "./lib/comic.js";
import { loadRosterIndex, type RosterIndex } from "./lib/roster.js";
import { loadOverrides, setOverride, repoKeyFromThreadId, type CastOverrides } from "./lib/casting.js";
import { loadSettings, saveSettings, type Settings } from "./lib/settings.js";
import { renderStripGrid } from "./lib/renderStrip.js";

const STYLE = `
  #ct-launcher {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px; border-radius: 999px; border: 2px solid #14131a;
    background: #d8443c; color: #fff; font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 4px 14px rgba(0,0,0,.25); cursor: pointer;
  }
  #ct-launcher:hover { filter: brightness(1.08); }
  #ct-overlay {
    position: fixed; inset: 0; z-index: 2147483001;
    background: #efe9db; overflow-y: auto;
    font: 400 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #14131a;
  }
  #ct-overlay.ct-hidden { display: none; }
  #ct-header {
    position: sticky; top: 0; z-index: 1;
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 12px 20px; background: #f7f3e9; border-bottom: 2px solid #14131a;
  }
  #ct-title { font-weight: 700; font-size: 16px; margin-right: auto; }
  .ct-btn {
    border: 2px solid #14131a; background: #fff; color: #14131a;
    border-radius: 8px; padding: 6px 12px; font-weight: 600; font-size: 13px;
    cursor: pointer;
  }
  .ct-btn.ct-primary { background: #d8443c; color: #fff; }
  #ct-state-chip {
    display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .04em; padding: 3px 9px; border-radius: 999px;
    border: 1.5px solid #14131a; background: #fff;
  }
  #ct-state-chip .ct-dot { width: 7px; height: 7px; border-radius: 50%; background: #2f6fd0; }
  #ct-state-chip.ct-closed .ct-dot { background: #d8443c; }
  #ct-state-chip.ct-merged .ct-dot { background: #7c4fd8; }
  #ct-cast { display: flex; gap: 6px; padding: 10px 20px; flex-wrap: wrap; }
  .ct-cast-chip {
    display: flex; align-items: center; gap: 6px; border: 2px solid #14131a;
    border-radius: 999px; padding: 3px 10px 3px 3px; background: #fff; cursor: pointer;
    font-size: 12px;
  }
  .ct-cast-chip img { width: 22px; height: 22px; border-radius: 50%; background: #efe9db; }
  #ct-body { padding: 8px 20px 40px; }
  #ct-state { padding: 60px 20px; text-align: center; font-size: 15px; }
  .ct-strip-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;
  }
  @media (max-width: 780px) { .ct-strip-grid { grid-template-columns: minmax(0, 1fr); } }
  .ct-panel-fig {
    margin: 0; display: block; background: #fff; border-radius: 3px;
    overflow: hidden; box-shadow: 0 3px 0 rgba(20,19,26,.12); line-height: 0;
  }
  .ct-panel-fig > svg { display: block; width: 100%; height: auto; }
  .ct-panel-wide { grid-column: 1 / -1; }
  .ct-panel-celebration { box-shadow: 0 0 0 3px #ffd23f, 6px 8px 0 rgba(20,19,26,.18); }
  .ct-panel-band {
    position: relative; background: none; box-shadow: none; overflow: hidden;
  }
  .ct-panel-band > svg { position: absolute; left: 0; top: 50%; width: 100%; height: auto; transform: translateY(-50%); }
  #ct-settings {
    position: absolute; right: 20px; top: 56px; background: #fff; border: 2px solid #14131a;
    border-radius: 10px; padding: 14px; width: 260px; box-shadow: 0 8px 20px rgba(0,0,0,.2);
  }
  #ct-settings.ct-hidden { display: none; }
  #ct-settings label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  #ct-settings input { width: 100%; box-sizing: border-box; padding: 6px 8px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 6px; }
`;

let styleInjected = false;
function ensureStyle(): void {
  if (styleInjected) return;
  const el = document.createElement("style");
  el.id = "ct-style";
  el.textContent = STYLE;
  document.head.appendChild(el);
  styleInjected = true;
}

function fetchThreadViaBackground(ref: ThreadRef, token: string): Promise<Thread> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "fetchThread", ref, token }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("no response from background worker"));
        return;
      }
      if (response.ok) resolve(response.thread as Thread);
      else reject(new Error(response.error as string));
    });
  });
}

class ComicOverlay {
  private root: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private castEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private stateChipEl: HTMLElement | null = null;
  private ref: ThreadRef | null = null;
  private thread: Thread | null = null;
  private rosterIndex: RosterIndex | null = null;
  private overrides: CastOverrides = {};
  private settings: Settings | null = null;
  private poller: ThreadPoller | null = null;

  ensureMounted(): HTMLElement {
    if (this.root) return this.root;
    ensureStyle();

    const root = document.createElement("div");
    root.id = "ct-overlay";
    root.className = "ct-hidden";
    root.innerHTML = `
      <div id="ct-header">
        <span id="ct-title">Comic Threads</span>
        <span id="ct-state-chip" class="ct-hidden"><span class="ct-dot"></span><span id="ct-state-label"></span></span>
        <button class="ct-btn" id="ct-reply" type="button">Reply on GitHub ↗</button>
        <button class="ct-btn" id="ct-settings-toggle" type="button">⚙ Settings</button>
        <button class="ct-btn ct-primary" id="ct-close" type="button">Close ✕</button>
      </div>
      <div id="ct-settings" class="ct-hidden">
        <label for="ct-token">GitHub token (optional)</label>
        <input id="ct-token" type="password" placeholder="ghp_…" autocomplete="off" />
        <button class="ct-btn ct-primary" id="ct-settings-save" type="button">Save</button>
      </div>
      <div id="ct-cast"></div>
      <div id="ct-body"><div id="ct-state">Loading…</div></div>
    `;
    document.body.appendChild(root);

    this.root = root;
    this.bodyEl = root.querySelector("#ct-body");
    this.castEl = root.querySelector("#ct-cast");
    this.titleEl = root.querySelector("#ct-title");
    this.stateChipEl = root.querySelector("#ct-state-chip");

    root.querySelector("#ct-close")!.addEventListener("click", () => this.hide());
    root.querySelector("#ct-settings-toggle")!.addEventListener("click", () => {
      root.querySelector("#ct-settings")!.classList.toggle("ct-hidden");
    });
    root.querySelector("#ct-settings-save")!.addEventListener("click", () => {
      void this.saveToken();
    });
    return root;
  }

  async saveToken(): Promise<void> {
    const input = this.root!.querySelector<HTMLInputElement>("#ct-token")!;
    this.settings = await saveSettings({
      token: input.value,
      pollIntervalMs: this.settings?.pollIntervalMs ?? 30_000,
    });
    this.root!.querySelector("#ct-settings")!.classList.add("ct-hidden");
    if (this.ref) void this.load(this.ref);
  }

  async show(ref: ThreadRef): Promise<void> {
    const root = this.ensureMounted();
    root.classList.remove("ct-hidden");
    if (this.ref && refId(this.ref) === refId(ref) && this.thread) return; // already showing it
    await this.load(ref);
  }

  hide(): void {
    this.root?.classList.add("ct-hidden");
    this.poller?.stop();
    this.poller = null;
  }

  isVisible(): boolean {
    return !!this.root && !this.root.classList.contains("ct-hidden");
  }

  private setState(html: string): void {
    if (this.bodyEl) this.bodyEl.innerHTML = `<div id="ct-state">${html}</div>`;
  }

  private async load(ref: ThreadRef): Promise<void> {
    this.ref = ref;
    this.setState("Loading the thread…");
    this.poller?.stop();
    this.poller = null;

    this.settings ??= await loadSettings();
    const replyBtn = this.root!.querySelector<HTMLButtonElement>("#ct-reply")!;
    replyBtn.onclick = () =>
      window.open(threadHtmlUrl(ref, ref.type === "pull"), "_blank", "noopener");

    let thread: Thread;
    try {
      thread = await fetchThreadViaBackground(ref, this.settings.token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState(
        `Couldn't load this thread.<br/><small>${escapeHtml(message)}</small><br/>` +
          `If this is rate-limiting, add a token in ⚙ Settings.`,
      );
      return;
    }
    this.thread = thread;
    this.renderHeader(thread);

    this.rosterIndex ??= await loadRosterIndex().catch(() => null);
    if (!this.rosterIndex) {
      this.setState("Couldn't load the character roster.");
      return;
    }
    this.overrides = await loadOverrides(repoKeyFromThreadId(thread.id));

    await this.renderThread(thread);

    // Live updates: same ETag-poll-and-append model as the web app.
    this.poller = new ThreadPoller().poll(
      ref,
      (_appended, freshThread) => {
        this.thread = freshThread;
        void this.renderThread(freshThread);
      },
      {
        initialThread: thread,
        token: this.settings.token || undefined,
        intervalMs: this.settings.pollIntervalMs,
        onThread: (fresh) => {
          this.thread = fresh;
          this.renderHeader(fresh);
        },
      },
    );
  }

  private renderHeader(thread: Thread): void {
    if (this.titleEl) this.titleEl.textContent = thread.title;
    const replyBtn = this.root?.querySelector<HTMLButtonElement>("#ct-reply");
    if (replyBtn) replyBtn.onclick = () => window.open(thread.url, "_blank", "noopener");
    if (this.stateChipEl) {
      this.stateChipEl.classList.remove("ct-hidden", "ct-closed", "ct-merged");
      if (thread.state !== "open") this.stateChipEl.classList.add(`ct-${thread.state}`);
      const label = this.stateChipEl.querySelector("#ct-state-label");
      if (label) label.textContent = thread.state;
    }
  }

  private async renderThread(thread: Thread): Promise<void> {
    if (!this.rosterIndex) return;
    const { comic, casting } = await composeComic(thread, this.rosterIndex, this.overrides);
    this.renderCastStrip(thread, casting);
    this.renderComic(comic);
  }

  private renderCastStrip(thread: Thread, casting: Map<string, string>): void {
    if (!this.castEl || !this.rosterIndex) return;
    const names = this.rosterIndex.characters.map((c) => c.name);
    this.castEl.innerHTML = "";
    for (const p of thread.participants) {
      const character = casting.get(p.login);
      const entry = this.rosterIndex.characters.find((c) => c.name === character);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ct-cast-chip";
      chip.title = `${p.login} — click to re-cast`;
      const img = document.createElement("img");
      img.src = entry
        ? chrome.runtime.getURL(`assets/characters/${entry.name}/${entry.iconImage}`)
        : "";
      img.alt = character ?? "";
      const label = document.createElement("span");
      label.textContent = p.login;
      chip.append(img, label);
      chip.addEventListener("click", () => {
        void this.recast(p.login, names, character);
      });
      this.castEl.appendChild(chip);
    }
  }

  private async recast(login: string, names: string[], current?: string): Promise<void> {
    if (!this.thread || names.length === 0) return;
    const idx = current ? names.indexOf(current) : -1;
    const next = names[(idx + 1) % names.length]!;
    this.overrides = await setOverride(
      repoKeyFromThreadId(this.thread.id),
      this.overrides,
      login,
      next,
    );
    await this.renderThread(this.thread);
  }

  private renderComic(comic: Comic): void {
    if (!this.bodyEl) return;
    const figs = renderStripGrid(comic);
    if (figs === null) {
      this.setState("Nothing to draw yet — this thread has no comments or events.");
      return;
    }
    this.bodyEl.innerHTML = `<div class="ct-strip-grid">${figs}</div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const overlay = new ComicOverlay();
let launcherEl: HTMLElement | null = null;
let currentRef: ThreadRef | null = null;

function syncForCurrentUrl(): void {
  const ref = parseThreadUrl(location.href);
  if (!ref) {
    launcherEl?.remove();
    launcherEl = null;
    currentRef = null;
    return;
  }
  currentRef = ref;
  if (launcherEl) return;

  ensureStyle();
  const btn = document.createElement("button");
  btn.id = "ct-launcher";
  btn.type = "button";
  btn.textContent = "🗨️ View as comic";
  btn.addEventListener("click", () => {
    if (currentRef) void overlay.show(currentRef);
  });
  document.body.appendChild(btn);
  launcherEl = btn;
}

syncForCurrentUrl();

// GitHub is a Turbo/pjax SPA — the URL and DOM change without a full page
// load. Re-check on Turbo's navigation event, and fall back to observing
// <title> (which GitHub always updates on navigation) for anything that
// event doesn't cover.
document.addEventListener("turbo:load", syncForCurrentUrl);
document.addEventListener("turbo:render", syncForCurrentUrl);
const titleEl = document.querySelector("title");
if (titleEl) {
  new MutationObserver(() => syncForCurrentUrl()).observe(titleEl, { childList: true });
}

// Toolbar-icon entry point (see background.ts's action.onClicked).
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "toggleOverlay") {
    return;
  }
  if (overlay.isVisible()) overlay.hide();
  else if (currentRef) void overlay.show(currentRef);
});
