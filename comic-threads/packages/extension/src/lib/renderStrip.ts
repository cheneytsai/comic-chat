/**
 * Panel-grid HTML: each panel as its own top-level <svg>, laid out with CSS
 * grid — the same approach the web app's ComicStrip.tsx uses, and not core's
 * renderComicSVG (one big SVG with nested per-panel <svg>s), which leans on
 * nested-SVG clipping that current browsers no longer apply by default. A
 * balloon that slightly overflows its panel bleeds into the neighbor under
 * that renderer instead of cropping at the border; per-panel top-level SVGs
 * plus fitPanel (which pulls oversized content back inside the frame in the
 * first place) avoid the problem entirely instead of depending on clipping to
 * paper over it. Shared by content.ts and dev/harness.ts so a harness
 * screenshot verifies the actual shipped code path, not a re-typed copy of it.
 */

import { renderPanelSVG, UNIT_WIDTH, type Comic, type Panel } from "@comic-threads/core";
import { fitPanel } from "./fitPanel.js";
import { bandHeight, isNarrationBand, planSpans } from "./pageLayout.js";

function renderPanelFigure(panel: Panel, span: "half" | "full"): string {
  const band = isNarrationBand(panel);
  const html = renderPanelSVG(fitPanel(panel), band ? { background: false } : {});
  const classes = [
    "ct-panel-fig",
    band ? "ct-panel-band" : "",
    panel.kind === "celebration" ? "ct-panel-celebration" : "",
    span === "full" ? "ct-panel-wide" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = band
    ? ` style="aspect-ratio: ${UNIT_WIDTH} / ${bandHeight(panel).toFixed(0)}"`
    : "";
  return `<figure class="${classes}"${style}>${html}</figure>`;
}

/** HTML for a `.ct-strip-grid` element's contents, or null if there's nothing to draw. */
export function renderStripGrid(comic: Comic): string | null {
  if (comic.panels.length === 0) return null;
  const spans = planSpans(comic.panels);
  return comic.panels.map((panel, i) => renderPanelFigure(panel, spans[i] ?? "half")).join("");
}
