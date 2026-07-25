import { describe, expect, it } from "vitest";
import type { Thread, ThreadEvent, Utterance } from "@comic-threads/core";
import {
  extractCodeBlocks,
  fetchThread,
  summarizeBotBody,
  type FetchLike,
} from "../fetch.js";
import { issueRoutes, makeFetch, prRoutes, TEST_BASE } from "./mockFetch.js";

const PR_REF = { owner: "acme", repo: "disco-ui", number: 42 };
const ISSUE_REF = { owner: "acme", repo: "disco-ui", number: 7 };

async function fetchPr(extra: { token?: string } = {}): Promise<{
  thread: Thread;
  fetchImpl: ReturnType<typeof makeFetch>;
}> {
  const fetchImpl = makeFetch(prRoutes());
  const thread = await fetchThread(PR_REF, {
    fetchImpl: fetchImpl as unknown as FetchLike,
    baseUrl: TEST_BASE,
    ...extra,
  });
  return { thread, fetchImpl };
}

function events(thread: Thread): ThreadEvent[] {
  return thread.items.filter((i): i is ThreadEvent => i.kind === "event");
}
function utterances(thread: Thread): Utterance[] {
  return thread.items.filter((i): i is Utterance => i.kind === "utterance");
}

describe("fetchThread — pull request", () => {
  it("normalizes the thread envelope", async () => {
    const { thread } = await fetchPr();
    expect(thread.source).toBe("github");
    expect(thread.id).toBe("acme/disco-ui#42");
    expect(thread.title).toBe("Dark mode toggle turns the entire app into a disco");
    expect(thread.url).toBe("https://github.com/acme/disco-ui/pull/42");
    // merged_at wins over the raw "closed" state.
    expect(thread.state).toBe("merged");
  });

  it("casts participants with roles, flagging bots by login suffix", async () => {
    const { thread } = await fetchPr();
    expect(thread.participants.map((p) => [p.login, p.role])).toEqual([
      ["octocat", "author"],
      ["grumpydev", "maintainer"],
      ["ci-bot[bot]", "bot"],
      ["lisa-codes", "contributor"],
    ]);
    const bot = thread.participants.find((p) => p.login === "ci-bot[bot]")!;
    expect(bot.displayName).toBe("ci-bot");
    expect(thread.participants[0]!.avatarUrl).toContain("avatars.githubusercontent.com");
  });

  it("opens with an 'opened' caption followed by the author's body", async () => {
    const { thread } = await fetchPr();
    const first = thread.items[0] as ThreadEvent;
    expect(first).toMatchObject({
      kind: "event",
      flavor: "open",
      text: "octocat opened this pull request",
      actor: "octocat",
    });
    const body = thread.items[1] as Utterance;
    expect(body.kind).toBe("utterance");
    expect(body.author).toBe("octocat");
    expect(body.mode).toBe("say");
  });

  it("extracts fenced code blocks and leaves placeholders behind (F6)", async () => {
    const { thread } = await fetchPr();
    const body = thread.items[1] as Utterance;
    expect(body.codeBlocks).toEqual([
      {
        lang: "ts",
        text: "const PARTY_MODE = true;\ntoggleTheme(dark ? 'strobe' : 'daylight');",
      },
    ]);
    expect(body.body).toContain("[code:1]");
    expect(body.body).not.toContain("```");
    // HTML comments are stripped from balloon text.
    expect(body.body).not.toContain("keep this template");

    const lisa = utterances(thread).find((u) => u.author === "lisa-codes" && u.codeBlocks)!;
    expect(lisa.codeBlocks).toHaveLength(2);
    expect(lisa.codeBlocks![0]!.lang).toBe("diff");
    expect(lisa.codeBlocks![1]!.lang).toBe("ts");
    expect(lisa.body).toContain("[code:1]");
    expect(lisa.body).toContain("[code:2]");
  });

  it("maps reaction names to emoji and drops zero counts", async () => {
    const { thread } = await fetchPr();
    const body = thread.items[1] as Utterance;
    expect(body.reactions).toEqual({ "👍": 2, "❤️": 1 });
    const grumpy = utterances(thread).find((u) => u.author === "grumpydev" && u.mode === "say")!;
    expect(grumpy.reactions).toEqual({ "👍": 1, "😄": 2 });
  });

  it("collapses long bot comments into caption summaries but keeps short ones", async () => {
    const { thread } = await fetchPr();
    const summary = events(thread).find((e) => e.actor === "ci-bot[bot]")!;
    expect(summary.flavor).toBe("misc");
    expect(summary.text).toBe("ci-bot[bot]: Build #4721 failed.");

    const shortBot = utterances(thread).find((u) => u.author === "ci-bot[bot]")!;
    expect(shortBot.body).toBe("Build #4722 passed. ✅");
  });

  it("renders PR review comments as whispers", async () => {
    const { thread } = await fetchPr();
    const whispers = utterances(thread).filter((u) => u.mode === "whisper");
    expect(whispers).toHaveLength(1);
    expect(whispers[0]).toMatchObject({
      author: "grumpydev",
      ts: "2026-07-10T09:22:00Z",
    });
    expect(whispers[0]!.body).toContain("ENABLE_STROBE_OF_DOOM");
  });

  it("maps review states onto caption flavors", async () => {
    const { thread } = await fetchPr();
    const flavors = events(thread).map((e) => e.flavor);
    expect(flavors).toContain("review-changes");
    expect(flavors).toContain("review-approve");

    const approve = events(thread).find((e) => e.flavor === "review-approve")!;
    expect(approve.text).toBe("✓ grumpydev approved these changes");
    expect(approve.actor).toBe("grumpydev");

    const changes = events(thread).find((e) => e.flavor === "review-changes")!;
    expect(changes.text).toBe("grumpydev requested changes");

    // The review's own body is still spoken; a COMMENTED review is body-only.
    const spoken = utterances(thread).map((u) => u.body);
    expect(spoken).toContain("PARTY_MODE is a wild name for a production constant.");
    expect(spoken).toContain("Reads fine to me.");
  });

  it("batches consecutive label/assign events by the same actor", async () => {
    const { thread } = await fetchPr();
    const labels = events(thread).filter((e) => e.flavor === "label");
    expect(labels).toHaveLength(2);
    expect(labels[0]!.text).toBe(
      "grumpydev added the labels: bug and disco-inferno and removed the label: needs-triage",
    );
    // A different actor breaks the run.
    expect(labels[1]!.text).toBe("lisa-codes added the label: p1");

    const assigns = events(thread).filter((e) => e.flavor === "assign");
    expect(assigns).toHaveLength(1);
    expect(assigns[0]!.text).toBe("grumpydev assigned lisa-codes and octocat");
  });

  it("narrates commits with the git author when there is no GitHub actor", async () => {
    const { thread } = await fetchPr();
    const commit = events(thread).find((e) => e.flavor === "commit")!;
    expect(commit.text).toBe("Lisa Codes pushed a commit: “fix: turn party mode off”");
    expect(commit.ts).toBe("2026-07-10T09:40:00Z");
  });

  it("emits a merge caption and suppresses the redundant close", async () => {
    const { thread } = await fetchPr();
    const merges = events(thread).filter((e) => e.flavor === "merge");
    expect(merges).toHaveLength(1);
    expect(merges[0]!.text).toContain("merged this pull request");
    expect(events(thread).some((e) => e.flavor === "close")).toBe(false);
    // Merge is the last beat of the strip.
    expect(thread.items[thread.items.length - 1]).toBe(merges[0]);
  });

  it("drops bookkeeping events (subscribed, duplicated comment/review entries)", async () => {
    const { thread } = await fetchPr();
    expect(events(thread).some((e) => e.text.includes("subscribed"))).toBe(false);
    // The timeline's `commented` echo must not double the real comment.
    const grumpySays = utterances(thread).filter(
      (u) => u.author === "grumpydev" && u.body.startsWith("Works on my machine"),
    );
    expect(grumpySays).toHaveLength(1);
  });

  it("keeps every item in timestamp order", async () => {
    const { thread } = await fetchPr();
    const stamps = thread.items.map((i) => Date.parse(i.ts));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });

  it("paginates comments by following the Link header", async () => {
    const { thread, fetchImpl } = await fetchPr();
    expect(fetchImpl.calls.some((u) => u.includes("comments?per_page=100&page=2"))).toBe(true);
    // 1 from page 2 is the bot's short comment, the other is lisa's.
    expect(utterances(thread).some((u) => u.author === "lisa-codes")).toBe(true);
    expect(utterances(thread).some((u) => u.body.includes("Build #4722"))).toBe(true);
  });

  it("sends the versioned Accept header and an optional bearer token", async () => {
    const { fetchImpl } = await fetchPr({ token: "ghp_secret" });
    for (const h of fetchImpl.headers) {
      expect(h.Accept).toBe("application/vnd.github+json");
      expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
      expect(h.Authorization).toBe("Bearer ghp_secret");
    }
    const anon = await fetchPr();
    expect(anon.fetchImpl.headers[0]!.Authorization).toBeUndefined();
  });
});

describe("fetchThread — plain issue", () => {
  it("uses the close flavor and never touches the pulls endpoints", async () => {
    const fetchImpl = makeFetch(issueRoutes());
    const thread = await fetchThread(ISSUE_REF, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
    });

    expect(thread.state).toBe("closed");
    expect(fetchImpl.calls.some((u) => u.includes("/pulls/"))).toBe(false);

    const close = events(thread).find((e) => e.flavor === "close")!;
    expect(close.text).toBe("grumpydev closed this issue");
    expect(events(thread).find((e) => e.flavor === "commit")!.text).toContain("referenced this");
    expect(events(thread).some((e) => e.text.includes("renamed this to"))).toBe(true);
    expect(thread.items[0]).toMatchObject({ flavor: "open", text: "newbie42 opened this issue" });
  });

  it("survives a repo whose timeline API is unavailable", async () => {
    const routes = issueRoutes().filter((r) => !r.url.endsWith("/timeline"));
    const fetchImpl = makeFetch(routes);
    const thread = await fetchThread(ISSUE_REF, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      baseUrl: TEST_BASE,
    });
    // Comments still land; only the event captions are missing.
    expect(utterances(thread)).toHaveLength(2);
    expect(events(thread).map((e) => e.flavor)).toEqual(["open"]);
  });

  it("throws a typed error when the issue itself is missing", async () => {
    const fetchImpl = makeFetch([]);
    await expect(
      fetchThread(ISSUE_REF, {
        fetchImpl: fetchImpl as unknown as FetchLike,
        baseUrl: TEST_BASE,
      }),
    ).rejects.toMatchObject({ name: "GitHubFetchError", status: 404 });
  });
});

describe("extractCodeBlocks", () => {
  it("handles tildes, missing languages and indentation", () => {
    const out = extractCodeBlocks("before\n\n~~~\nplain\n~~~\n\nafter");
    expect(out.codeBlocks).toEqual([{ lang: "", text: "plain" }]);
    expect(out.body).toBe("before\n\n[code:1]\n\nafter");
  });

  it("leaves unterminated fences alone", () => {
    const src = "oops ```js\nnever closed";
    expect(extractCodeBlocks(src).codeBlocks).toHaveLength(0);
  });

  it("does not touch inline code", () => {
    const out = extractCodeBlocks("use `npm ci` here");
    expect(out.codeBlocks).toHaveLength(0);
    expect(out.body).toBe("use `npm ci` here");
  });
});

describe("summarizeBotBody", () => {
  it("truncates on a word boundary with an ellipsis", () => {
    const long = `dependabot bumps a package ${"and again ".repeat(40)}`;
    const out = summarizeBotBody("dependabot[bot]", long);
    expect(out.startsWith("dependabot[bot]: ")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(200);
  });
});
