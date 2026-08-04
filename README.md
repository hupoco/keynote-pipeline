# keynote-pipeline

A self-contained HTML product keynote, a scroll-driven product page that **runs** the same deck
live instead of re-telling it, a short teaser cut, and a Gemini/ElevenLabs pipeline for generating
the media that goes into all three.

Fork it, replace the four placeholder slides in `deck/index.html` with your own story, and the
site and teaser follow along — there's exactly one place your content lives.

## Quickstart
```bash
npm install
npx playwright install chromium      # for screenshots / PDF / video export
cp .env.example .env                 # optional — only needed for media generation
npm start                            # → http://localhost:5179/site/
```
Open the deck directly at `/deck/index.html`, or the teaser at `/short/index.html`.

## What's here
- `deck/index.html` — the keynote. One file, no build step, no external requests, opens by
  double-click. Four slides demonstrating the motion engine (staggered builds, self-drawing SVG
  edges, graph nodes) — replace them with your own.
- `site/` — the product page. Pins the real deck in an iframe per section and scrolls it to the
  slide that section names. Nothing here is a re-implementation of the deck's content.
- `short/` — a minimal teaser: an edit-decision-list (`edl.js`) drives the deck through a fast cut
  on a timer, and the same page is the recording target for `npm run export:short`.
- `scripts/` — generation (`gen-image`, `gen-video`, `gen-voiceover`, `gen-audio`) and export
  (`screenshot`, `export-pdf`, `export-video`, `build:standalone`, `serve`) tooling.
- `docs/pipeline-guide.md` — **read this before you extend anything.** How the pieces fit together,
  and the non-obvious constraints (serving over http, video export needing a real display, byte
  ranges) that are easy to silently break.
- `docs/design-system.md` — the deck's CSS/motion conventions.
- `docs/assets.md` — generating and inserting media, plus hard-won video-generation lessons.

## Requirements
- Node ≥ 20.6
- A `GEMINI_API_KEY` (https://aistudio.google.com/apikey) if you want to generate images/video
- An ElevenLabs key if you want generated narration/sound — both are optional; the deck, site, and
  teaser all work with zero generated media

## License
MIT — see `LICENSE`.
