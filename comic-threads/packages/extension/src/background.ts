/**
 * Service worker. Content scripts run in the page's world and their fetch()
 * calls are subject to the *host page's* CSP — github.com's CSP has no
 * particular reason to allow connect-src to api.github.com from injected
 * script, so the actual GitHub request happens here instead, where only the
 * extension's own host_permissions apply. The content script asks for a
 * thread by message; this relays the answer back.
 */

import { fetchThread, type ThreadRef } from "@comic-threads/github-source";
import type { Thread } from "@comic-threads/core";

interface FetchThreadRequest {
  type: "fetchThread";
  ref: ThreadRef;
  token?: string;
}

type FetchThreadResponse = { ok: true; thread: Thread } | { ok: false; error: string };

function isFetchThreadRequest(msg: unknown): msg is FetchThreadRequest {
  return !!msg && typeof msg === "object" && (msg as { type?: unknown }).type === "fetchThread";
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isFetchThreadRequest(message)) return false;

  fetchThread(message.ref, { token: message.token || undefined })
    .then((thread) => {
      const response: FetchThreadResponse = { ok: true, thread };
      sendResponse(response);
    })
    .catch((err: unknown) => {
      const response: FetchThreadResponse = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      sendResponse(response);
    });

  return true; // keep the message channel open for the async sendResponse
});

// Toolbar icon: a second entry point to the same overlay the in-page button
// opens (no default_popup is set, which is what makes onClicked fire at all).
chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    void chrome.tabs.sendMessage(tab.id, { type: "toggleOverlay" });
  }
});
