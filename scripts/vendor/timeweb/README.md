# timeweb 0.3.2 (vendored)

`timeweb.js` is the built `dist/timeweb.js` from [timeweb](https://github.com/tungs/timeweb)
v0.3.2 by Steve Tung, BSD-3-Clause (see `LICENSE`). Nothing here is modified.

It is committed rather than installed for the same reason the deck has no external requests: an
export must reproduce a year from now, and a virtual clock that silently changes version changes
every frame it renders.

## What it does

It replaces the page's sense of time — `Date.now`, `performance.now`, `requestAnimationFrame`,
`setTimeout`/`setInterval`, CSS transitions and animations, `element.animate`, and
`HTMLVideoElement` playback — with a clock the renderer advances by hand. `scripts/export-video-deterministic.mjs`
injects it as the first `<head>` script and then calls `window.timeweb.goTo(ms)` once per frame,
so frame N *is* the page at N/FPS seconds regardless of how long the render took.

It does not virtualise `<audio>`. That shim is hand-written inside `export-video-deterministic.mjs`,
which logs every play/pause/volume event to `window.__alog` and rebuilds the soundtrack offline.

## Upgrading

Replace `timeweb.js` and `LICENSE` together, note the new version here, then re-run the frame-hash
comparison against `scripts/export-video.mjs`'s headful output before trusting it. A virtual-clock
change is not visible in a diff — it is only visible in the frames.
