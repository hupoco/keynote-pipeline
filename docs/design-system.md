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
- Nav: → ← / space / click / swipe; `Home` / `End`; **F** = fullscreen.
- Adding or removing a `<section class="slide">` updates the slide count automatically — no config.
- `#clean` (or `?clean`) on the deck's URL hides the presenter chrome — used by the site's stage
  and by video export, so a capture is frame-identical to what's authored, minus the furniture.
