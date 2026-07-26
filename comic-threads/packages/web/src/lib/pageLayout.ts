/**
 * Page layout: how composed panels are arranged on the page. Core lays out the
 * inside of a panel; this decides how wide each one is drawn and which ones are
 * narration ribbons rather than framed panels.
 */

import { CAPTION_FONT_SIZE, UNIT_WIDTH, wrapText, type Panel } from "@comic-threads/core";

export type PanelSpan = "half" | "full";

/**
 * A caption panel with nobody in it is pure narration ("alice added the label
 * bug"). Drawn as a full 4:3 panel it is a caption strip marooned in a big
 * white box, wasting most of a page row on a one-line beat. Those render
 * frameless (core's `background: false`) and are cropped to a wide ribbon
 * across the page — the narration strip a comic page actually uses.
 */
export function isNarrationBand(panel: Panel): boolean {
  return panel.kind === "caption" && panel.bodies.length === 0 && !!panel.caption;
}

/**
 * How tall a narration ribbon needs to be, in core's unit space: the caption
 * box the renderer will draw (`renderCaption` wraps to `UNIT_WIDTH - 120` and
 * pads by 32) plus a little air. Measured with core's own text metrics so the
 * crop always matches what lands in the SVG, however long the caption is.
 */
export function bandHeight(panel: Panel): number {
  const wrapped = wrapText(panel.caption ?? "", UNIT_WIDTH - 120, CAPTION_FONT_SIZE);
  return wrapped.height + 32 + 44;
}

/**
 * The grid is two columns; narration ribbons and celebration panels span both,
 * and drawn panels pair up. A run of drawn panels with an odd length would
 * otherwise leave a half-empty row, so its last panel is widened to span —
 * every row ends up full, whatever shape the thread has.
 */
export function planSpans(panels: Panel[]): PanelSpan[] {
  const spans: PanelSpan[] = panels.map(() => "half");
  let runStart = 0;
  const closeRun = (end: number): void => {
    const length = end - runStart;
    if (length > 0 && length % 2 === 1) spans[end - 1] = "full";
    runStart = end + 1;
  };
  panels.forEach((panel, i) => {
    if (isNarrationBand(panel) || panel.kind === "celebration") {
      closeRun(i);
      spans[i] = "full";
    }
  });
  closeRun(panels.length);
  return spans;
}
