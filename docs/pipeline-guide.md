# The pipeline guide

This is a fork-and-replace starter: a self-contained HTML keynote (`deck/`), a scroll-driven
product page that runs the same deck live (`site/`), a short teaser cut (`short/`), and a Gemini +
ElevenLabs pipeline for generating the media that goes into all three. Read this once before you
start replacing content.

## The core idea, in one paragraph
Author your story exactly once, as slides in `deck/index.html`. Everything else **runs** that deck
instead of re-telling it: the product page hosts it live in a pinned, scroll-driven iframe
(`site/stage.js`), and the short teaser drives it through a fast cut on a timer (`short/edl.js`).
If you fix a typo or restyle a component in the deck, the site and the teaser pick it up for free —
there is exactly one place your story's content lives.

## Extend the deck
1. Read `docs/design-system.md` for the class/motion conventions before you touch CSS.
2. Add a `<section class="slide" data-slide="N">` with your content, reusing the documented
   classes (`.display`, `.wrap.split`, `.a-up`, `.edge`, …) so it stays visually cohesive with the
   rest.
3. If the slide needs a generated image or video, see `docs/assets.md`.
4. Verify: `npm run shots -- --only N` renders just that slide to `assets/shots/slide-0N.png` — open
   it and check for overflow, illegible text, or motion that doesn't read.

If you're driving this with an AI coding agent: point it at `docs/design-system.md` and ask for the
change in plain terms ("add a slide after 2 that shows X, using the `.a-*` and `.gen-media`
conventions"). That's genuinely sufficient — the design system doc exists so you don't have to
re-explain the conventions every time.

## Wire the site to your new slides
`site/index.html` has one `<section data-stage data-slide="N">` per slide you want to appear on the
scroll page. Add, remove, or reorder these to match your deck — `data-slide` must match the
0-indexed slide it should show. `site/stage.js` builds an iframe for each stage as it nears the
viewport, tells the hosted deck which slide to show (`window.__go(n)`, which your deck already
exposes), and tears the iframe down once it's scrolled far away. Read the comment block at the top
of `stage.js` before changing the arrival/build/destroy logic — the timing decisions there
(poll instead of sleep, lazy iframe lifecycle, scale-not-reflow) were each a real bug once.

**Must be served over http, never opened via `file://`.** The site reaches into each iframe's
`contentWindow`, and `file://` gives every document its own opaque origin — that read throws under
`file://` even for two files sitting in the same folder. Run `npm start` (or `npm run serve:site`).

## Cut the teaser
`short/edl.js` exports an ordered list of `{ t, slide, hold }` — when to be on which slide, and for
how long. `short/index.html` is a bare page that hosts the deck fullscreen and drives it off that
list on a timer; it's also the literal recording target for `npm run export:short`. Extend the list
the same way you'd extend a real edit-decision-list once you have actual video footage to cut
between — see the comment in `edl.js` for what a production build of this pipeline grew this into
(a frame-accurate cut against real clips, word-cards, and sound cues) once it had footage to
justify the complexity.

## Generate media
`scripts/gen-image.mjs` / `gen-video.mjs` call Gemini (image / Veo video) and drop the result in
`assets/generated/`, printing the exact `<div class="gen-media">…` snippet to paste into a slide.
`scripts/gen-voiceover.mjs` (ElevenLabs) and `scripts/gen-audio.mjs` generate narration and
sound/music from `scripts/voiceover-script.mjs` / `scripts/audio-script.mjs` — replace the two
illustrative entries in each with your own. See `docs/assets.md` for the full loop and, importantly,
the video-generation section — those lessons cost real API calls to learn the first time.

## Export
- `npm run shots` — every slide to `assets/shots/*.png`, your eyes' verification step.
- `npm run pdf` — the deck as a landscape PDF, one slide per page.
- `npm run build:standalone` — inlines every local asset into `deck/dist/standalone.html`, one
  portable file that opens by double-click with no server.
- `npm run export:video` / `npm run export:short` — records the deck / the short page to an mp4.
  **Read the next section before you run this** — the constraints below are non-obvious and easy
  to silently violate.

## Video export: what you need to know before it works
This is the part of the pipeline most likely to look "almost right" while being subtly broken, so
these are stated as flatly as possible.

- **`scripts/serve.mjs` must be the thing serving the page you're recording**, and it must serve
  real HTTP byte ranges. Without them, a `<video>` element's `seekable` range is empty, seeking
  silently no-ops, and any video content in your deck sits frozen on its first frame throughout the
  whole recording.
- **`npm run export:video` needs a real, unlocked display — it cannot run headless.**
  `getDisplayMedia()` (which is how it captures the tab, picture and sound together in one
  `MediaStream`) rejects outright in headless Chromium under every flag combination. Use
  `scripts/export-video-deterministic.mjs` instead if you need this in CI or over SSH — it's a
  virtual-clock renderer, roughly 5x slower, and is the unmaintained fallback for exactly this case.
- **Audio only works over http, never `file://`.** `createMediaElementSource()` (which the audio tap
  needs) silences a cross-origin `<audio>`/`<video>` element outright, and under `file://` a
  relative `src` counts as cross-origin. This is the same constraint that makes the site require a
  server — you already have to serve this project either way.
- **Don't add `--disable-gpu-vsync` or `--disable-frame-rate-limit`** to "help" the capture. They
  let the render loop free-run far above any real display rate, decoupling your deck's animation
  timing from anything a viewer's monitor could actually show — this reads as unnaturally fast,
  stuttery motion in the output, not as higher quality.
- If you add your own audio, keep the Web Audio graph **alive** with a near-silent constant source
  feeding the destination — an idle graph can stop producing samples entirely partway through a
  long recording, truncating the audio track while the video keeps going.

## Present live
`npm run serve` → open the deck → **F** for fullscreen, arrows/space to advance. This starter's
motion engine ships without an autoplay/narration driver — see the comment in `deck/index.html`'s
`<script>` block for the one hook (`window.__go`) you'd wire a driver against if you build one — pace it off each narration clip's
actual playback length rather than a guessed reading time; a clip's length is the one thing that
can't drift out of sync with itself.
