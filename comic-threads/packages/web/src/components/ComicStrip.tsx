/**
 * The strip itself. Each panel is rendered by core's SVG renderer (a pure
 * string function) and mounted as-is — the visual output is identical to what
 * the Node-side snapshot tests assert, so the browser adds no second opinion
 * about how a comic looks. Preact only owns the page layout, the entrance
 * animation for freshly polled panels, and auto-scroll.
 */

import { useEffect, useMemo, useRef } from "preact/hooks";
import { UNIT_WIDTH, renderPanelSVG, type Comic } from "@comic-threads/core";
import type { Panel } from "@comic-threads/core";
import { fitPanel } from "../lib/fitPanel.js";
import {
  bandHeight,
  isNarrationBand,
  planSpans,
  type PanelSpan,
} from "../lib/pageLayout.js";

function PanelView({
  panel,
  fresh,
  span,
}: {
  panel: Panel;
  fresh: boolean;
  span: PanelSpan;
}): preact.JSX.Element {
  const band = isNarrationBand(panel);
  const html = useMemo(
    () => renderPanelSVG(fitPanel(panel), band ? { background: false } : {}),
    [panel, band],
  );
  const classes = [
    "panel",
    `panel-${panel.kind}`,
    band ? "panel-band" : "",
    span === "full" ? "panel-wide" : "",
    fresh ? "panel-fresh" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <figure
      class={classes}
      style={band ? { aspectRatio: `${UNIT_WIDTH} / ${bandHeight(panel).toFixed(0)}` } : undefined}
      // core's renderer emits a static SVG string from data it composed itself;
      // every text node goes through escapeXml() on the way out.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export interface ComicStripProps {
  comic: Comic;
  /** panels at this index and beyond animate in (new since the last poll). */
  freshFrom: number;
  autoScroll: boolean;
}

export function ComicStrip({ comic, freshFrom, autoScroll }: ComicStripProps): preact.JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null);
  const panelCount = comic.panels.length;
  const spans = useMemo(() => planSpans(comic.panels), [comic.panels]);

  useEffect(() => {
    if (!autoScroll) return;
    if (freshFrom >= panelCount) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [autoScroll, freshFrom, panelCount]);

  if (panelCount === 0) {
    return <p class="empty">Nothing to draw yet — this thread has no comments or events.</p>;
  }

  return (
    <div class="strip">
      <div class="strip-grid">
        {comic.panels.map((panel, i) => (
          <PanelView
            key={`${comic.id}:${i}`}
            panel={panel}
            fresh={i >= freshFrom}
            span={spans[i] ?? "half"}
          />
        ))}
      </div>
      <div ref={endRef} class="strip-end" />
    </div>
  );
}
