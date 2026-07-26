import { describe, expect, it } from "vitest";
import type { Thread, Utterance } from "@comic-threads/core";
import { toSpokenText, toSpokenThread } from "../lib/speech.js";

describe("toSpokenText", () => {
  it("drops the [code:N] placeholder the fetcher leaves behind", () => {
    expect(toSpokenText("Here's the fix: [code:1]")).toBe("Here's the fix:");
    expect(toSpokenText("[code:1] and [code:2] both")).toBe("and both");
  });

  it("keeps link and image text, drops the URL", () => {
    expect(toSpokenText("See [the full logs](https://ci.example.com/b/1), then stop.")).toBe(
      "See the full logs, then stop.",
    );
    expect(toSpokenText("![a screenshot](x.png) done")).toBe("a screenshot done");
    expect(toSpokenText("<https://example.com>")).toBe("https://example.com");
  });

  it("removes emphasis, inline code fences and line-leading notation", () => {
    expect(toSpokenText("a **strong** and _soft_ and ~~gone~~ point")).toBe(
      "a strong and soft and gone point",
    );
    expect(toSpokenText("## Heading\n\n- one\n- two\n\n> quoted")).toBe("Heading one two quoted");
    expect(toSpokenText("1. first\n2. second")).toBe("first second");
  });

  it("does not eat underscores inside identifiers", () => {
    expect(toSpokenText("nit: `PARTY_MODE` -> `ENABLE_STROBE_OF_DOOM`.")).toBe(
      "nit: PARTY_MODE -> ENABLE_STROBE_OF_DOOM.",
    );
    expect(toSpokenText("call __init__ then snake_case_ident")).toBe(
      "call __init__ then snake_case_ident",
    );
    expect(toSpokenText("2 * 3 * 4 is twenty-four")).toBe("2 * 3 * 4 is twenty-four");
  });

  it("strips HTML comments and collapses whitespace", () => {
    expect(toSpokenText("<!-- PR template -->\n\n  Actual   text \n")).toBe("Actual text");
  });

  it("leaves plain prose exactly as it was", () => {
    const plain = "Works on my machine ;-) Did you clear your cache?";
    expect(toSpokenText(plain)).toBe(plain);
  });
});

describe("toSpokenThread", () => {
  const utterance = (body: string, codeBlocks?: Utterance["codeBlocks"]): Utterance => ({
    kind: "utterance",
    author: "octocat",
    body,
    ts: "2026-07-10T09:00:00Z",
    mode: "say",
    ...(codeBlocks ? { codeBlocks } : {}),
  });

  const thread = (items: Thread["items"]): Thread => ({
    source: "github",
    id: "acme/ui#1",
    title: "t",
    url: "https://github.com/acme/ui/pull/1",
    state: "open",
    participants: [{ login: "octocat", displayName: "Octo", role: "author" }],
    items,
  });

  it("rewrites utterance bodies and leaves events alone", () => {
    const input = thread([
      { kind: "event", ts: "2026-07-10T09:00:00Z", text: "octocat opened this", flavor: "open" },
      utterance("look at **this**"),
    ]);
    const out = toSpokenThread(input);
    expect(out.items[0]).toBe(input.items[0]);
    expect((out.items[1] as Utterance).body).toBe("look at this");
  });

  it("gives a wordless code-only comment something to say", () => {
    const out = toSpokenThread(thread([utterance("[code:1]", [{ lang: "ts", text: "x" }])]));
    expect((out.items[0] as Utterance).body).toBe("…");
  });

  it("returns the same object when nothing needed rewriting", () => {
    const input = thread([utterance("nothing to strip here")]);
    expect(toSpokenThread(input)).toBe(input);
  });
});
