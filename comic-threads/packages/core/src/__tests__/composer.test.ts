import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composeThread } from "../compose/composer.js";
import { MAX_BALLOONS_PER_PANEL } from "../compose/types.js";
import { renderPanelSVG, renderComicSVG } from "../render/svg.js";
import type { Thread } from "../model.js";
import { testRoster } from "./testRoster.js";

function loadDemo(): Thread {
  const url = new URL("../../../../assets/fixtures/demo-thread.json", import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as Thread;
}

describe("composer golden", () => {
  const thread = loadDemo();
  const roster = testRoster();
  const comic = composeThread(thread, { roster });

  it("produces a stable panel-shape snapshot", () => {
    const shape = comic.panels.map((p) => ({
      kind: p.kind,
      speakers: p.balloons.map((b) => b.speakerLogin).filter(Boolean),
      balloonKinds: p.balloons.map((b) => b.kind),
      bodies: p.bodies.map((b) => b.login),
      caption: p.caption ? p.caption.slice(0, 20) : undefined,
      hasTerminal: !!p.terminal,
      decorations: p.decorations,
    }));
    expect(shape).toMatchSnapshot();
  });

  it("never exceeds 5 balloons per panel", () => {
    for (const p of comic.panels) {
      expect(p.balloons.length).toBeLessThanOrEqual(MAX_BALLOONS_PER_PANEL);
    }
  });

  it("never repeats a speaker's balloon within a panel", () => {
    for (const p of comic.panels) {
      const speakers = p.balloons.map((b) => b.speakerLogin);
      expect(new Set(speakers).size).toBe(speakers.length);
    }
  });

  it("renders every panel to non-empty SVG", () => {
    for (const p of comic.panels) {
      const svg = renderPanelSVG(p);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain("</svg>");
    }
    expect(renderComicSVG(comic)).toContain("<svg");
  });

  it("extracts the code block into a terminal card panel", () => {
    const withTerminal = comic.panels.filter((p) => p.terminal);
    expect(withTerminal.length).toBeGreaterThanOrEqual(1);
  });

  it("celebrates the merge with a starburst panel", () => {
    const celebration = comic.panels.find((p) => p.kind === "celebration");
    expect(celebration).toBeDefined();
    expect(celebration?.decorations).toContain("stars");
  });
});

describe("determinism", () => {
  it("composes identically across two runs", () => {
    const thread = loadDemo();
    const a = composeThread(thread, { roster: testRoster() });
    const b = composeThread(thread, { roster: testRoster() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
