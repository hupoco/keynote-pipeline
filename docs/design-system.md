# Design system

Everything lives in `deck/index.html`'s `<head><style>` block. Reuse these classes so edits stay
cohesive. **Prefix any new classes/ids/@keyframes** with a per-slide tag (e.g. `.s5-orbit`,
`@keyframes s5-spin`) so slides never collide as the deck grows.

## Foundations
- **Palette** (CSS vars, all in `:root`): `--accent` (primary brand color) + `--accent-tint`
  (its pale wash); text `--ink`; page `--paper` / `--paper-2`; `--muted`; hairlines `--line` /
  `--line-2`. Swap these six values for your brand and most of the deck re-themes itself — but
  expect to also hunt down any per-slide hardcoded colors you add later as you build slides; a
  design system this size only stays coherent if you route color through the tokens, not literals.
- **Type:** this starter ships with a system-font stack (zero network requests, works immediately).
  When you have a real typeface, embed the `.woff2` files in `assets/fonts/` and point `--jak`
  (display) / `--body` (body) at them via `@font-face`. One family for both, at different weights,
  is a deliberate constraint worth keeping — it forces hierarchy decisions onto weight/size/spacing
  instead of a second face, and it's one less asset to keep in sync with the deck.
- **Zero external requests.** No Google Fonts, no CDNs, no vendored `<script src>` pointing off
  the page. Anything you add must be embedded or inlined, or you break the double-click-to-open
  promise (see `npm run build:standalone`).

## Slide wrapper
```html
<section class="slide" data-slide="4">
  <div class="wrap"> … </div>              <!-- or .wrap.center, .wrap.split, .wrap.split.rev -->
</section>
```
`data-slide` must be the slide's 0-indexed position — the site's stage sections address slides by
this number (see `site/stage.js`), so keep it in sync if you reorder slides.

## Type & layout classes
- `.display` (giant hero word/line), `.h-xl`, `.h-lg`, `.lead` (body copy).
- `.kicker` (eyebrow label; add `.c` to center it). Inline: `.grad` (accent-gradient text),
  `.muted` (dedicated grey).
- `.wrap.center`, `.wrap.split` (2-col, add `.rev` to flip which side is which).
- `.pill` (rounded tag; include `<span class="dot"></span>`), `.chipset` + `.gchip` (mono chips),
  `.card` (bordered surface), `.big-quote` (a huge single-statement line).
- **Media placeholder for generated assets:** `.gen-media` (framed slot, add `.glow` for a soft
  accent-colored shadow) — see `docs/assets.md` for wiring in actual generated images/video.

## Motion engine (this is what makes it feel alive)
Elements animate **when their slide becomes active**, and the engine re-triggers the animation on
every revisit (see the `render()` function in `deck/index.html`'s script) — a slide you scroll back
to replays its build instead of sitting there fully formed.
- Entry classes + stagger: `.a-up` (fade+rise), `.a-in` (fade), `.a-pop` (scale-in), `.a-slide`
  (from the side), with an inline `style="--d:0.6s"` delay.
- **Self-drawing SVG lines:** `class="edge"` on a `<path>` + attribute `pathLength="1"`
  (+ optional `--d`).
- **Graph node pop:** `class="gnode a-pop"` (+ `--d`).
- `prefers-reduced-motion` is respected automatically — reduced-motion users get the static
  end-state, no animation.

## Rules worth keeping as the deck grows
1. **One idea per slide.** Big type, generous negative space. If you're unsure whether something
   belongs, it probably doesn't.
2. Isolate and enlarge a single component and animate it — never a cramped screenshot of a whole
   app crammed into a slide.
3. Benefit language, short sentences. Reserve a second visual register (e.g. a dark "under the
   hood" mode) for genuinely different content, not as decoration.
4. Every slide should have a staggered build — including captions. A caption sitting at full
   opacity from frame 0 makes the whole build read as already finished.
5. **Render-safe:** keep content within ~1080px tall at a 16:9 stage; verify with `npm run shots`.
6. **Never name third-party vendors/products you depend on** in slide copy if you can avoid it —
   say what the *technique* is (e.g. "vector search", "structured extraction") instead of the
   specific product, so the deck doesn't date itself when you swap providers.
7. **Mocks share a scale.** If you draw the same kind of UI mock (e.g. a browser window) on two
   different slides, keep it the same relative size both times — a shrunk repeat reads as
   unfinished.

## Landmines worth knowing before they cost you a debugging session
- **A CSS custom property registered via `@property` with `inherits:true` will silently reject a
  non-matching value type anywhere in the DOM**, not just where you defined it — e.g. a `<length>`
  property fed a percentage falls back to its initial value with no warning. If you register a
  custom property this way, never reuse its name as an unrelated local variable elsewhere.
- **`opacity<1`, `filter`, `overflow≠visible`, `backdrop-filter`, and `contain:paint` all force
  `transform-style:flat`** on any element carrying them, collapsing any 3D transforms on their
  descendants. If you build a 3D scene, dim individual leaf elements, never a 3D-carrying ancestor.
- **`animation` is a shorthand property** — a higher-specificity rule that sets `animation` on an
  element *replaces* whatever animation was already running rather than adding to it, and removing
  the overriding class restarts the original animation from its first keyframe (a visible jump).
  Check `animation-name` in devtools on the actual element before adding a competing rule.
- **Short, generic class names collide as a deck grows.** `.ck`, `.uc`, `.cl`, `.b` are exactly the
  names you'll reach for under time pressure, and exactly the ones most likely to already be
  claimed by an earlier slide's throwaway helper class. Grep before inventing a class name; prefix
  per-slide/per-feature as rule zero already says.
- **An inline `<b>`/`<i>`/`<span>` inside a flex row becomes its own flex item**, which injects the
  row's `gap` on both sides of it — silently spacing a sentence out. Wrap inline emphasis in a
  non-flex ancestor if a caption's spacing looks wrong.

## Engine / controls
- Nav: → ← / space / click / swipe; `Home` / `End`; **F** = fullscreen; **p** = autoplay; **m** = mute.
- Adding or removing a `<section class="slide">` updates the slide count automatically — no config.
  Count it from the DOM, never from a note in a file: every derived record of "how many slides"
  drifts, and the DOM is the only one that cannot.
- `#clean` (or `?clean`) on the deck's URL hides the presenter chrome and the cursor — used by the
  site's stage and by video export, so a capture is frame-identical to what's authored, minus the
  furniture. Preview exactly what gets recorded by opening `deck/index.html#clean` yourself.
- `--xfade` is the slide crossfade length. It is read by **both** the `.slide` CSS transition and
  the engine's navigation lock, because a press landing mid-crossfade is swallowed. Change it in
  `:root` only — two numbers here means a driver eventually spends presses into a transition.

## The window contract
Everything else in this repo drives the deck through these. Keep them working and you can rewrite
the rest. `site/stage.js`, `short/index.html`, `scripts/screenshot.mjs`, `scripts/export-pdf.mjs`
and both video exporters all reach in here.

| Hook | |
|---|---|
| `__go(n)` | jump to slide `n` (0-based), clamped |
| `__next()` `__prev()` | the SAME advance every key, click and swipe uses — so nothing driving the deck has to re-implement what a press does |
| `__isLocked()` | true while a slide transition is in flight. A press during the lock is **swallowed**, so a driver must defer rather than burn it |
| `__slideCount` | how many slides there are |
| `__hold` | set true to stop a self-advancing slide handing itself over. The capture tools set it so a screenshot lands on the slide it asked for |
| `__pace(ms)` | scale an authored gap by `__deckPace` |
| `__autoplay` | `{start, stop, running}` — **the recorder's contract.** Both video exporters call `start()` and poll `running`; `#autobtn`'s `aria-pressed` is their fallback |
| `__deckAudio` | `{sfx, toBed, bedFor, amb, ambStop, duck, setMuted, …}` |
| `__autoplayTiming` | every pacing knob, live in devtools |

Two hooks a **slide** may set on itself, both optional:
- `slide.__subProg = () => ({i, n})` — where its own beats have got to. The progress bar and the
  autoplay driver both read it, so a slide that owns several beats is never advanced past
  mid-sequence. One expression, three consumers; they cannot disagree.
- `slide.__slideStep = (dir) => boolean` — consume a press to step its own beats; return `false` at
  either end to hand the key back to the deck. This is what makes a long build rehearsable.

## The `data-*` vocabulary
Behaviour is declared on the slide, not wired up in script. Everything here is optional and inert
until you use it.

| Attribute | What it does |
|---|---|
| `data-vo-lines="3"` | this slide narrates `slide-NN`, `slide-NN-2`, `slide-NN-3` back to back as a **queue**, each starting when the last ends. A long slide needs this: picking one line by which third of `__subProg` you are in leaves most of the slide silent *and* cuts any line long enough to say something |
| `data-vo-at="0,2,4"` | per queued line, the `__subProg().i` value that line waits for, so the voice tracks the picture. **Note the convention:** `__subProg` returns `{i: cur+1}`, so these are `i` values — one ahead of the driver's own step index. Line 1 is never gated |
| `data-vo-delay="4200"` | hold the FIRST line until the slide's own copy has arrived. A plain time gate is right here precisely because the thing being waited for IS a time-based CSS animation with no state to read |
| `data-chat="name"` | run `window.CHAT_SCRIPTS['name']` when this slide goes live, reset when it leaves |
| `data-chat-ms="6400"` | how long that script runs, so autoplay waits for it. Sum the `{wait}` steps plus 28ms per typed character and round up. Without it, `__autoplayTiming.defaultChatMs` is used — long enough to be *safe*, not right |
| `data-amb="amb-kitchen"` | room tone under this slide, from `assets/sfx/`, at the gain in the deck's `AMB_GAIN` map |

### Sizing a narration line
**~2.2 words/second**, measured. Aim for the slide's own length; a comma-separated list costs more
than its word count suggests. Voiceover ids must match `scripts/voiceover-script.mjs` exactly —
`slide-01`, `slide-01-2`. Say the NEXT thing, not the same thing: the screen names it, the line
gives the consequence.

## Audio
All optional; silent until `npm run gen:audio` / `npm run gen:voiceover` have written the files. The
levels in the deck's `SFX_GAIN` / `BEDS` / `AMB_GAIN` maps are **duplicated by hand** from
`scripts/audio-script.mjs`, because the deck cannot read a `manifest.json` over `file://` (a fetch
of a local file is blocked) and a wrong level is a far cheaper failure than a broken deck. Keep the
two in step.

- Beds are zoned by 1-based slide number and crossfade **equal-power** (`cos`/`sin`). Two opposing
  linear ramps dip ~3dB at the midpoint — an audible hole exactly where the transition is meant to
  be seamless.
- Beds **duck** ~8dB while narration is speaking, released on a 420ms bridge so back-to-back lines
  stay one duck but a gated wait lets the music back up.
- `resume: true` picks a bed up where it left off. Restarting a long bed's first bar every time you
  re-enter its zone means the opening few seconds are the only part anyone ever hears.
- **Audio never enters the Web Audio graph.** `createMediaElementSource()` outputs permanent
  silence for a cross-origin source, and under `file://` a relative src IS cross-origin. Gain nodes
  would be the "proper" way and would silently play nothing. Volume ramps use element `.volume`.

## Autoplay
**p** or the ▶ button walks the deck unattended. It drives the same `__next()` a keypress does, and
only decides *when* to press:

- a slide publishing `__subProg` is **watched**, not driven — advancing mid-sequence races its own
  timer and skips a beat
- a slide carrying a non-looping `<video>` is paced to **the clip's own remaining duration**. Never
  a constant: a reading-time dwell capped at 5s applied to an 8s shot cuts the shot at 44%. A
  *looping* video is excluded — it has no end to play to
- a `data-chat` slide gets `data-chat-ms`
- anything else gets **read time** from its own `innerText`, so it scales with what is on screen

Narration, where it exists, overrides all of that — the clip's own length is the dwell. Two knobs,
both live in devtools: `__autoplayTiming.beatPace` compresses every slide's authored gaps (floored
at 1250ms so no beat loses its CSS transition), and `__autoplaySpeed` scales only the dwells
autoplay itself invents. **Narration never scales** — a clip's length is its length, and stretching
a voice distorts it.

Any manual gesture cancels autoplay. It stops itself at the end by *observing the deck stall*
rather than by predicting which press is the last one.
