# Comic Threads

**Microsoft Comic Chat, reborn as a comic view for GitHub threads.**

Comic Threads renders a GitHub issue or pull request as an automatically
composed comic strip — the way Microsoft Comic Chat (1996) rendered IRC. It is
a modern presentation layer: the "protocol" underneath is the GitHub REST API
instead of IRC, and the client is a static web app instead of an MFC
application.

- Participants are cast as the original MIT-licensed Comic Chat characters
  (extracted from the `.avb` art in this repository).
- A TypeScript port of the original expert system infers emotions and gestures
  from comment text, breaks the timeline into panels, places and flips
  characters so they face each other, and lays out speech / thought / shout /
  whisper balloons with routed tails.
- Timeline events (labels, reviews, merges, closes) become narration caption
  boxes, so a PR reads as a story — with a star-burst panel when it merges.
- Threads update live via polling; new comments animate in as new panels.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the product brief, requirements,
the web-app-vs-extension decision, architecture, the fidelity map back to the
1996 sources, and the phased engineering plan.

## Layout

| Path | Contents |
|---|---|
| `packages/core` | the comic engine: emotion rules, panel composer, SVG renderer (no DOM, no network) |
| `packages/github-source` | GitHub REST adapter: fetch, normalize, ETag polling |
| `packages/web` | Vite + Preact app shell |
| `tools/avb-extract` | Node CLI that extracts `.avb` character art to PNG + manifest |
| `assets/characters` | extracted character poses (committed build artifacts) |
| `assets/fixtures` | sample threads for demo mode and tests |

## Quick start

```bash
cd comic-threads
npm install
npm run build          # builds all workspaces
npm test               # engine tests (vitest)
npm run dev            # dev server for the web app (demo mode works offline)
```

To (re)extract character art from the original sources:

```bash
npm run extract-art    # runs tools/avb-extract over ../v1.0-pre-modern/comicart/avatars
```

## Attribution

Character art and composition algorithms derive from the Microsoft Comic Chat
sources in this repository (MIT License; © Microsoft). Comic Chat was created
by DJ Kurlander and the Microsoft Research Virtual Worlds group. Comic Threads
is an unofficial homage; no Microsoft endorsement is implied.
