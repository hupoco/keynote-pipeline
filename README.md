# keynote-pipeline

A self-contained HTML product keynote, a scroll-driven product page that **runs** the same deck
live instead of re-telling it, a short teaser cut, and a Gemini/ElevenLabs pipeline for generating
the media that goes into all three.

Fork it, replace the four placeholder slides in `deck/index.html` with your own story, and the
site and teaser follow along — there's exactly one place your content lives.

**Building this out for your own product? Read [`docs/adopting-for-your-product.md`](docs/adopting-for-your-product.md) first** — where this repo should live relative to your product's codebase, the order to actually build in (story → deck → real screenshots → site/teaser wiring), and how to use Claude Code (or another coding agent) to do the mechanical work while you make the editorial calls, including pulling real screenshots from your running product instead of relying on generated stand-ins.

## Quickstart
```bash
npm install
npx playwright install chromium      # for screenshots / PDF / video export
cp .env.example .env                 # optional — only needed for media generation
npm start                            # → http://localhost:5179/site/
```
Open the deck directly at `/deck/index.html`, or the teaser at `/short/index.html`.

Press **p** to watch the whole thing play itself, **m** to mute, **F** for fullscreen.

## What's here
- `deck/index.html` — the keynote. One file, no build step, no external requests, opens by
  double-click. Four slides demonstrating the motion engine (staggered builds, self-drawing SVG
  edges, graph nodes) — replace them with your own. Underneath them is a **harness you should
  keep**: autoplay that paces itself to what is actually on each slide, an optional narration
  queue, music beds that duck under the voice, and scripted playback for a product mock. All of it
  is inert until you use it, and all of it is documented in `docs/design-system.md`.
- `site/` — the product page. Pins the real deck in an iframe per section and scrolls it to the
  slide that section names. Nothing here is a re-implementation of the deck's content.
- `short/` — a minimal teaser: an edit-decision-list (`edl.js`) drives the deck through a fast cut
  on a timer, and the same page is the recording target for `npm run export:short`.
- `scripts/` — generation (`gen-image`, `gen-video`, `gen-voiceover`, `gen-audio`) and export
  (`screenshot`, `export-pdf`, `export-video`, `export-short`, `build:standalone`, `serve`) tooling.
  `scripts/vendor/timeweb/` is a committed BSD-3 dependency, not an installed one — an export has
  to reproduce a year from now, and a virtual clock that changes version changes every frame.
- `docs/adopting-for-your-product.md` — **start here if this is for a real product.** Where this
  repo should live relative to your codebase, the build order, and how to work with Claude Code
  (or another agent) to do it.
- `docs/pipeline-guide.md` — how the pieces fit together, and the non-obvious constraints (serving
  over http, video export needing a real display, byte ranges) that are easy to silently break.
- `docs/design-system.md` — the deck's CSS/motion conventions.
- `docs/assets.md` — generating and inserting media, plus hard-won video-generation lessons.

## Requirements
- Node ≥ 20.6
- `ffmpeg` + `ffprobe` on PATH for either video export (and recommended for `gen:audio`, which uses
  them to trim and level takes — without them nothing is levelled and raw takes can span 20 dB)
- A `GEMINI_API_KEY` (https://aistudio.google.com/apikey) if you want to generate images/video
- An ElevenLabs key if you want generated narration/sound — both are optional; the deck, site, and
  teaser all work with zero generated media

Dependencies are **pinned exact, not ranged**, and two of them are load-bearing beyond their API
surface. `playwright` decides which Chromium runs, and `export-video.mjs`'s `--audio-shift -38ms` is
a constant measured against that build's `AudioContext.baseLatency` — the script asserts it and
stops rather than silently producing sound that feels slightly off. Re-run
`node scripts/export-video.mjs --probe` after any Playwright bump.

## License
MIT — see `LICENSE`.
