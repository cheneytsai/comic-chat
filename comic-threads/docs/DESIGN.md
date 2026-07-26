# Comic Threads — Design & Engineering Plan

**Comic Threads** is a modern reimagining of Microsoft Comic Chat (1996): instead of
wrapping the IRC protocol, it is a **presentation layer for forum-style threads**,
starting with GitHub issues and pull requests. A thread is rendered as an
automatically composed comic strip — characters, gestures, expressions, word
balloons, panel breaks, zoom — using a faithful port of the original Comic Chat
"expert system", driven by the original MIT-licensed character art from this
repository.

This document covers the product brief, requirements, the key architecture
decision (web app vs. browser extension), the system design with a fidelity map
back to the 1996 source, and a phased engineering plan.

---

## 1. Product brief

> Retain the notable UX and presentation of Comic Chat, but replace the IRC
> transport with popular forum sites — GitHub first — as the conversation
> source. Ship a proof-of-concept that is small but genuinely shippable.

### Why GitHub first (agreeing with the brief, with evidence)

- **Bounded cast per thread.** GitHub issues/PRs typically have 2–8 unique
  voices — the same range Comic Chat panels were designed for (panels hold 1–4
  characters comfortably).
- **Linear conversation.** Issue/PR timelines are single-threaded (review
  comments nest one level, which maps cleanly to "whisper" asides). Reddit's
  tree structure would force us to solve thread-flattening before drawing
  anything; HN is a tree too.
- **Rich event stream.** Labels, assignments, commits, reviews, merges, closes —
  these map beautifully onto Comic Chat's *caption boxes* (narration) and give
  the strip an actual story arc: issue opened → discussion → "changes
  requested" drama → merge celebration (the original even had a star-burst
  routine, `AddStars`, for special moments).
- **Clean, unauthenticated read API** with ETag conditional requests, so a
  pure-client app works with no backend.

Reddit (flatten "top comments" sort) and HN (Firebase API — which is
genuinely real-time) are follow-on adapters behind the same interface.

### Non-goals for the MVP

- Authoring new character art (we reuse the original AVB art, MIT-licensed in
  this repo).
- Writing comments from inside the comic UI (read-only MVP; "Reply on GitHub"
  deep-link instead. Posting via OAuth is Phase 3).
- Reddit/HN adapters (interface is designed for them; not built).
- Pixel-perfect parity with 1996 layout internals.

---

## 2. Chrome extension vs. web app — the decision

The brief suggests a Chrome extension that skins github.com threads. Challenge
accepted; here is the trade-off and the recommendation.

| | Web app (paste/share a URL) | Extension (in-situ toggle) |
|---|---|---|
| Install friction | none — a link | store review, install, permissions |
| Shareability | **a comic view of any issue is itself a shareable link** — the growth loop | can't share what others can't render |
| Data access | GitHub REST, stable & versioned | either scrape GitHub's DOM (brittle, changes monthly) or call REST anyway |
| Auth | optional PAT for rate limits/private repos | rides the user's session **only if scraping**; REST still needs a token |
| Real-time | polling (same in both) | polling (same in both) |
| Eng surface | one deploy target | MV3 service-worker quirks, CSP, review cycles |

The decisive observations:

1. **Even inside an extension, the right data source is the REST API, not the
   page DOM.** Timeline events, reactions and review threads are partially
   rendered/paginated in the DOM; scraping them is strictly worse than the API.
   Once the extension is calling the API, it is just a worse-distributed web
   app.
2. **The comic is a shareable artifact.** "Look at this issue as a comic" only
   works as a link if rendering doesn't require an install. That's the demo
   moment for this product.

**Decision: build the renderer as a platform-agnostic core library, ship a web
app as the MVP shell, and ship the extension as a second, thin shell in Phase 2**
(a MV3 content script that injects a "🗨️ View as comic" button on
`github.com/*/issues/*` and overlays the same bundle — the core is
DOM-independent, so the extension is ~150 lines of glue, not a fork). This
keeps the in-situ "skin" UX the brief wanted, without betting the architecture
on it.

**Real-time:** GitHub has no push channel for browsers. The MVP polls with
ETag conditional requests (HTTP 304 responses don't count against the rate
limit, so a 30 s cadence is safe even unauthenticated) and animates new panels
in as they arrive — the strip visibly grows while you watch, which reads as
"live". True push (a tiny relay: GitHub App webhooks → SSE) and the HN
Firebase adapter (actually real-time) are Phase 3 options; neither blocks MVP.

---

## 3. Requirements

### Functional — MVP (Phase 1)

- **F1. Thread ingest:** given a GitHub issue or PR URL, fetch title, body,
  comments, timeline events (close/merge/label/assign/review) via REST;
  normalize into a source-agnostic `Thread` model.
- **F2. Character casting:** each participant is deterministically assigned a
  character from the extracted original roster (stable hash of login, collision
  handling); the viewer can re-cast any participant and choose "self";
  choices persist in `localStorage`.
- **F3. Emotion & gesture inference:** port of the original rule engine
  (`AllCaps` / `FindString` / `CheckWord` / `CheckStart`, case-sensitive and
  `*` variants, strength-weighted) with the original shipped rule tables, plus
  modern rules: emoji & `:shortcodes:`, "LGTM", "ship it", "+1", "wtf", "???",
  markdown cues.
- **F4. Panel composition:** faithful-lite port of the original composer:
  same-speaker-again / ≥5 balloons / overflow → new panel; only speakers are
  drawn; alternating flips so characters face each other; position hysteresis
  across panels; zoom-in when few characters; balloons occupy the top half
  with tails routed to speakers; long text splits across continuation panels.
- **F5. Balloon & caption types:** speech, thought, shout (spiky), whisper
  (dashed) balloons and rectangular caption boxes, rendered in SVG in the
  original visual style. Mapping: comments → speech; timeline events →
  captions; PR review comments → whisper; `> quotes` → thought-style echo
  (drop for MVP if fiddly); ALL-CAPS/`!!!` → shout.
- **F6. Code handling:** fenced code blocks are pulled out of balloons and
  rendered as a "terminal card" panel element the speaker points at
  (`EM_POINTOTHER` pose); long blocks truncate with a "view on GitHub" link.
- **F7. Original art:** characters render from the original AVB art (poses
  extracted to PNG + manifest at build time). Backgrounds: solid/gradient room
  default; original BGB backdrops are a stretch goal.
- **F8. Live updates:** ETag polling; new comments append panels with a small
  entrance animation; a "LIVE" indicator shows polling state.
- **F9. Demo mode:** a bundled fixture thread renders with zero network — the
  landing page shows the product working before any URL is pasted.
- **F10. Shareable URLs:** `/#/gh/{owner}/{repo}/issues/{n}` routes.
- **F11. Optional PAT** (never sent anywhere but api.github.com, stored
  locally) for rate limits and private repos.

### Non-functional

- **N1.** No backend; static hosting (GitHub Pages–deployable).
- **N2.** A 100-comment thread composes + renders in < 1 s on a laptop
  (composition is O(comments); rendering is virtualized per page if needed).
- **N3.** Core library has zero DOM dependencies (runs in Node for tests;
  embeddable in the extension shell).
- **N4.** Unit tests for the emotion engine and composer (golden-thread
  snapshots).
- **N5.** Licensing hygiene: art extracted from MIT-licensed sources in this
  repo, with attribution and a trademark note (no implied Microsoft
  endorsement).

### Phase 2+ (planned, not built now)

- Chrome extension shell (MV3, in-situ toggle on github.com).
- Export: PNG/strip image of a page; "share this panel" cards.
- Posting replies (GitHub OAuth device flow) — the `saywnd` say-box, reborn.
- Reddit + HN adapters; HN via Firebase for true real-time.
- BGB backdrop extraction; scene semantics (the original's `AddSemantics`).
- Webhook relay for push updates.

---

## 4. Architecture

```
comic-threads/
├── docs/DESIGN.md               ← this document
├── packages/
│   ├── core/                    ← the expert system + renderer (no DOM, no fetch)
│   │   ├── src/model.ts         ← Thread/Utterance/Participant types
│   │   ├── src/emotion/         ← rule engine + rule tables (port of textpose.cpp)
│   │   ├── src/compose/         ← panel composer (port of panel.cpp AddLine/LayoutAvatars)
│   │   ├── src/render/          ← SVG string/vdom renderer (balloon.cpp shapes)
│   │   └── src/characters.ts    ← manifest loading, casting, pose picking (bodycam.cpp)
│   ├── github-source/           ← URL parsing, REST fetch, normalize, ETag poller
│   ├── web/                     ← Vite + Preact shell (routing, casting UI, settings, demo)
│   └── extension/               ← MV3: content script (in-page button + overlay) + background worker
├── tools/
│   └── avb-extract/             ← Node CLI: .avb → PNG poses + manifest.json
└── assets/
    ├── characters/<name>/       ← extracted pose PNGs + manifest.json (build artifact, committed)
    └── fixtures/                ← sample normalized threads for demo mode & tests
```

Data flow:

```
GitHub REST ──► github-source (normalize, poll) ──► Thread
Thread ──► core/emotion (per-utterance CEmotion) ──► core/compose (panels)
       ──► core/render (SVG) ──► web shell (Preact) / extension shell (MV3)
assets/characters ──► core/characters (pose selection by emotion wheel distance)
```

### 4.1 The Thread model (source-agnostic)

```ts
interface Thread {
  source: "github";            // later: "reddit" | "hn"
  id: string;                  // "owner/repo#123"
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  participants: Participant[]; // login, displayName, avatarUrl, role (author/maintainer/bot)
  items: ThreadItem[];         // ordered timeline
}
type ThreadItem =
  | { kind: "utterance"; author: string; body: string; ts: string;
      mode: "say" | "whisper";           // whisper = PR review comment
      reactions?: Record<string, number>;
      codeBlocks?: { lang: string; text: string }[] }
  | { kind: "event"; ts: string; text: string;   // rendered as caption box
      flavor: "open" | "close" | "merge" | "label" | "assign" |
              "review-approve" | "review-changes" | "commit" | "misc" };
```

Bots (dependabot, CI) are cast as robot-ish characters and their walls of text
are summarized into captions rather than balloons.

### 4.2 Fidelity map — original source → TypeScript port

| Original (v1.0/client) | What it does | Port |
|---|---|---|
| `textpose.cpp` + `chat.rc` `ID_RULE_*` | emotion rule engine: `AllCaps("");9`, `FindString(":)");10`, `CheckWord("LOL");11`, `CheckStart("Hi");2`, `*`=case-insensitive; strongest rule wins among `CEmotionOpts` | `core/src/emotion/engine.ts` + `rules.ts` (original tables verbatim, then modern additions) |
| `avatar.h` emotion wheel | 8 emotions at angles `k·2π/8` (happy, coy, bored, scared, sad, angry, shout, laugh) + intensity radius 0–1; gestures as discrete IDs (wave, point-self, point-other, shrug…) | `core/src/emotion/wheel.ts` — same polar model |
| `bodycam.cpp` `GetBodyFromEmotion` | pick pose nearest to (emotion,intensity) on the wheel; exact-match gestures; neutral fallback with variety | `core/src/characters.ts` `pickPose()` |
| `panel.cpp` `AddLine` (l.359) | **panel-break rules:** force-break for captions; break when panel has ≥5 balloons, or when speaker already in panel; else *clone last panel and re-lay-out*; overflow → split text, continuation panel | `core/src/compose/composer.ts` — same rules, same clone-and-replace behavior |
| `panel.cpp` `LayoutAvatars` (l.525) | only speakers drawn; heights normalized (body ≤ panelH/1.9); shrink-to-fit or zoom-in (capped so heads aren't cropped, `headFactor · 1.2`); even margins; `arrowX` = balloon tail target; placement hysteresis (`UpdateHistoresis`, `OrderAvatars`) | `core/src/compose/layout.ts` |
| `panel.cpp` `LayoutBalloons` / `RearrangeBalloons` | balloons in top half, left-to-right in utterance order, tails must not cross | `core/src/compose/balloons.ts` |
| `balloon.cpp` | balloon geometries: speech cloud, thought bubbles trail, spiky shout, dashed whisper, rectangular label/caption | `core/src/render/balloons.ts` (SVG paths) |
| `avatario.cpp` + `avatar.cpp` `GetPoseFromID` + `dib.cpp` | AVB container: 16-bit keyed records; poses = DIB at `fgndOffset` + 1-bit mask DIB at `transOffset` (+ optional aura); simple avatars = whole-body poses, complex = face×torso composited via `xCX/yCX/delta` offsets | `tools/avb-extract` (build-time, Node) |
| `panel.cpp` `AddStars` | celebration star-bursts | merge-event panel flourish |
| `semantic.cpp` | keyword → backdrop/scene changes (mostly vestigial "Ohio" easter egg) | out of scope; noted for Phase 3 |

### 4.3 Character manifest (contract between `avb-extract` and `core`)

```jsonc
// assets/characters/<name>/manifest.json
{
  "name": "susan",
  "source": "v1.0-pre-modern/comicart/avatars/susan.avb",
  "type": "simple" | "complex",
  "iconImage": "icon.png",
  // simple avatars: whole-body poses
  "bodies": [ { "image": "body-00.png", "w": 160, "h": 220,
                "emotion": "happy", "intensity": 0.6,
                "faceX": 80, "faceY": 30 } ],
  // complex avatars: faces and torsos selected independently, composited
  "faces":  [ { "image": "face-00.png", "w": 90, "h": 84,
                "emotion": "angry", "intensity": 1.0,
                "xCX": 12, "yCX": 3, "dxCX": 0, "dyCX": 0,
                "faceX": 40, "faceY": 20 } ],
  "torsos": [ { "image": "torso-00.png", "w": 150, "h": 140,
                "emotion": "neutral", "intensity": 0.0, "xCX": 30, "yCX": 8 } ]
}
```

`emotion` is one of
`neutral|happy|coy|bored|scared|sad|angry|shout|laugh|wave|pointother|pointself|doublepoint|shrug|walk1|walk2|walk3`
(indices 0–17 from `avatario.cpp:emFloats`). Compositing a complex avatar:
head offset = `(torso.xCX + face.dxCX − face.xCX, torso.yCX + face.dyCX − face.yCX)`
(see `avatar.cpp:CBodyDouble::GetDimInfo`). PNGs carry alpha from the mask DIB.
Until real art lands, `core` develops against a fixture manifest with
placeholder art — the schema above is frozen first.

### 4.4 GitHub → comic semantic mapping

| GitHub construct | Comic treatment |
|---|---|
| Issue/PR title | strip title block (original page title treatment) |
| Issue body | first speech balloon(s) from the author |
| Comment | speech balloon; long → continuation panels (cap ~3, then "read more" caption) |
| Fenced code | terminal card + speaker in point pose |
| PR review comment | whisper balloon |
| Review: approve | author pose happy/laugh; caption "✓ alice approved" |
| Review: request changes | shout/angry inference boost; caption |
| Merge | caption + celebration panel with star-burst |
| Close (not merged) | caption; cast waves goodbye (EM_WAVE) |
| Labels/assign/commits | caption boxes (batched if consecutive) |
| Reactions | mini-emoji stack next to the balloon |
| @mention of a participant | point-other gesture; mentioned character joins panel if absent |
| Bot comment | robot character; body collapsed into caption summary |

---

## 5. Engineering plan

### Phase 0 — Design & scaffold *(this session)*
- T0.1 Research original engine (rules, formats, composition) — **done**
- T0.2 This document; freeze the manifest schema and Thread model
- T0.3 Monorepo scaffold (npm workspaces, TS config, Vite, vitest, CI-friendly build)

### Phase 1 — MVP *(this session, parallel work streams)*

**Stream A — art pipeline** (`tools/avb-extract`, `assets/characters/`)
- A1. AVB container parser (keyed records, offsets) per `avatario.cpp`
- A2. DIB decoder (8-bpp palettized, BI_RLE8 per `dib.cpp`) → RGBA
- A3. Mask application → PNG with alpha; icon extraction
- A4. Manifest emission per §4.3; run over `v1.0-pre-modern/comicart/avatars/`
- A5. Contact-sheet HTML for visual QA of every extracted pose

**Stream B — engine + app** (`packages/*`)
- B1. `core` model + emotion engine w/ original + modern rule tables (+ tests)
- B2. Composer: panel breaking, avatar layout, balloon layout (+ golden tests)
- B3. SVG renderer: balloons, captions, characters, panels, page grid
- B4. `github-source`: URL parse, fetch issue/PR + comments + events + reviews,
      normalize, ETag poller
- B5. `web` shell: routes, landing w/ demo fixture, casting UI, PAT settings,
      live-append animation
- B6. Fixture thread + demo mode

**Integration** *(after A+B)*
- I1. Real manifests into `web`; pose-selection sanity pass across roster
- I2. End-to-end verification (build, tests, Playwright screenshot of demo
      render; live fetch if network allows), fix-ups
- I3. Docs, license/attribution notes, commit, push

### Phase 2 — the skin & the share loop
- **Extension shell (MV3 toggle on github.com) reusing the same bundle — built.**
  `packages/extension`: a content script drops a fixed "🗨️ View as comic"
  button on `github.com/*/issues/*` and `*/pull/*` (placement deliberately
  doesn't depend on GitHub's DOM — see §2's scraping argument, which applies
  to insertion points too, not just data) and opens a full-screen overlay
  reusing `core`'s composer/renderer directly. The actual GitHub fetch runs in
  the background service worker, not the content script: a content script's
  `fetch()` is subject to the *host page's* CSP, so the request goes through
  `chrome.runtime.sendMessage` to a worker that only needs the extension's own
  `host_permissions`. `chrome.storage.local` replaces `localStorage` for the
  PAT and cast overrides — content-script `localStorage` is the *page's*
  storage, shared with (and readable by) the page's own scripts, which would
  quietly undermine "the token is only ever sent to api.github.com."
  The glue (`roster.ts`, `comic.ts`, `casting.ts`, `settings.ts`, `speech.ts`,
  `fitPanel.ts`, `pageLayout.ts`) is copied from `packages/web` rather than
  factored into a shared package yet — small and DOM/fetch-free enough that
  duplication beats a premature abstraction for a second consumer; worth
  promoting into `core` if a third shell shows up. One thing this pass
  surfaced that belongs in `core` itself: `renderComicSVG` nests each panel as
  its own `<svg>` without `overflow="hidden"`, and current browsers no longer
  clip nested SVGs by default (that UA-stylesheet special case was dropped) —
  fixed there, but the extension additionally renders each panel as an
  independent top-level `<svg>` in a CSS grid (mirroring `ComicStrip.tsx`)
  rather than calling `renderComicSVG`, both to match the web app's
  already-verified visual output and to get `fitPanel`'s overflow repacking,
  which `renderComicSVG` doesn't apply.
- PNG export of a page / panel share cards
- GitHub Pages deploy workflow
- Roster expansion (Art Pack 1 `.avb`s from v2.5), BGB backdrops

### Phase 3 — chat, for real
- OAuth device flow + posting comments (the say-box returns)
- Webhook relay (GitHub App → SSE) for push updates
- Reddit adapter (flattened), HN adapter (Firebase = real real-time)

### Risks

| Risk | Mitigation |
|---|---|
| AVB parsing surprises (RLE variants, complex-avatar offsets) | format is small & fully sourced here; contact sheet catches artifacts; fallback = ship the subset of characters that extract cleanly (need ~10 for casting) |
| GitHub rate limits (60/h anon) | ETag 304s are free; PAT option; demo mode never hits network |
| 1996 art at modern DPI (~160 px sprites) | render at authentic size w/ crisp scaling; it's a feature (period charm), not a bug |
| Long/markdown-heavy comments break balloon aesthetics | aggressive summarization into captions + continuation caps; code extracted to cards |

---

## 6. Attribution

Character art and composition algorithms derive from the Microsoft Comic Chat
sources in this repository (MIT License; © Microsoft). Comic Chat was created
by DJ Kurlander, David Salesin, and the Microsoft Research Virtual Worlds
group. This project is an unofficial homage; no Microsoft endorsement implied.
