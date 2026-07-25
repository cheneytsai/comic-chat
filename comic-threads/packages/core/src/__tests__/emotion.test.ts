import { describe, expect, it } from "vitest";
import {
  inferEmotion,
  inferOriginal,
  checkForUppers,
  checkWord,
  stripMarkup,
} from "../emotion/engine.js";
import { rngFromString } from "../rng.js";

describe("primitives", () => {
  it("checkForUppers needs >1 upper and no lower", () => {
    expect(checkForUppers("HELLO")).toBe(true);
    expect(checkForUppers("Hello")).toBe(false);
    expect(checkForUppers("A")).toBe(false); // only one upper
    expect(checkForUppers("AB!")).toBe(true);
  });

  it("checkWord matches whole words only", () => {
    expect(checkWord("i said lol ok", "lol")).toBe(true);
    expect(checkWord("that's lolz", "lol")).toBe(false); // followed by alnum
    expect(checkWord("LOL!", "LOL")).toBe(true); // punct after
  });
});

describe("original shipped rules (chat.rc:1029-1036)", () => {
  it('"HELLO!!!" → shout', () => {
    expect(inferOriginal("HELLO!!!").emotion).toBe("shout");
  });

  it('"LOL no way" → laugh', () => {
    expect(inferOriginal("LOL no way").emotion).toBe("laugh");
  });

  it('":-)" → happy', () => {
    expect(inferOriginal(":-)").emotion).toBe("happy");
  });

  it('":(" → sad', () => {
    expect(inferOriginal("well that broke :(").emotion).toBe("sad");
  });

  it('";-)" → coy', () => {
    expect(inferOriginal("sure it works ;-)").emotion).toBe("coy");
  });

  it('sentence-start "You broke it" → pointother (beats pointself)', () => {
    const e = inferOriginal("You broke it");
    expect(e.emotion).toBe("pointother");
  });

  it('"Hello there" → wave', () => {
    expect(inferOriginal("Hello there").emotion).toBe("wave");
  });

  it("returns neutral when nothing fires", () => {
    expect(inferOriginal("the sky is blue").emotion).toBe("neutral");
  });
});

describe("modern rules", () => {
  it('"LGTM 🎉" → happy', () => {
    expect(inferEmotion("LGTM 🎉").emotion).toBe("happy");
  });

  it('"wtf is this" → angry', () => {
    expect(inferEmotion("wtf is this").emotion).toBe("angry");
  });

  it('"ship it 🚀" → happy', () => {
    expect(inferEmotion("ship it").emotion).toBe("happy");
  });

  it('"this is broken" → sad', () => {
    expect(inferEmotion("this is broken").emotion).toBe("sad");
  });

  it('"nit: rename this" → coy', () => {
    expect(inferEmotion("nit: rename this").emotion).toBe("coy");
  });

  it("😡 → angry", () => {
    expect(inferEmotion("😡").emotion).toBe("angry");
  });
});

describe("markup stripping", () => {
  it("ignores SHOUTING inside code fences", () => {
    const e = inferEmotion("here is code:\n```\nHELLO!!!\n```\nlooks fine");
    expect(e.emotion).not.toBe("shout");
  });

  it("strips inline code and urls", () => {
    const s = stripMarkup("see `CONST_NAME` at https://example.com/PATH done");
    expect(s).not.toContain("CONST_NAME");
    expect(s).not.toContain("example.com");
  });

  it("drops blockquotes", () => {
    const s = stripMarkup("> WHY IS THIS BROKEN\nmy reply");
    expect(s).not.toContain("WHY");
  });
});

describe("tie-breaks are seeded/deterministic", () => {
  it("same rng seed → same choice", () => {
    // ":)" and ":(" both strength 10 — a tie.
    const a = inferEmotion(":) :(", { rng: rngFromString("seed-1") }).emotion;
    const b = inferEmotion(":) :(", { rng: rngFromString("seed-1") }).emotion;
    expect(a).toBe(b);
    expect(["happy", "sad"]).toContain(a);
  });
});
