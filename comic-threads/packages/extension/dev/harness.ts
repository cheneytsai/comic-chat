/**
 * Render harness — NOT part of the shipped extension (unreferenced by
 * manifest.json, built by a separate script). This sandbox can't reach real
 * github.com pages to exercise the content script end-to-end, so this loads
 * as the extension's own chrome-extension:// page instead (which needs no
 * host permissions) and drives the exact same composeComic → renderComicSVG
 * path content.ts uses, against the same demo thread fixture the web app's
 * offline demo uses and the real bundled character art. It skips only the
 * two things that genuinely require github.com: the floating-button
 * injection and the chrome.runtime message relay to the background worker.
 */
import { composeComic } from "../src/lib/comic.js";
import { loadRosterIndex } from "../src/lib/roster.js";
import { renderStripGrid } from "../src/lib/renderStrip.js";
import demoThread from "../../../assets/fixtures/demo-thread.json" with { type: "json" };
import type { Thread } from "@comic-threads/core";

async function main(): Promise<void> {
  const thread = demoThread as unknown as Thread;
  const rosterIndex = await loadRosterIndex();
  const { comic, casting } = await composeComic(thread, rosterIndex, {});

  const header = document.createElement("div");
  header.style.cssText =
    "font: 700 20px system-ui; padding: 16px 20px; background:#f7f3e9; border-bottom:2px solid #14131a;";
  header.textContent = `${thread.title}  [${thread.state}]  — cast: ${[...casting.entries()]
    .map(([login, name]) => `${login}→${name}`)
    .join(", ")}`;
  document.body.appendChild(header);

  const figs = renderStripGrid(comic);
  const body = document.createElement("div");
  body.className = "ct-strip-grid";
  body.innerHTML = figs ?? "Nothing to draw yet.";
  document.body.appendChild(body);

  (window as unknown as { __harnessDone: boolean }).__harnessDone = true;
}

main().catch((err: unknown) => {
  document.body.textContent = `harness error: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
