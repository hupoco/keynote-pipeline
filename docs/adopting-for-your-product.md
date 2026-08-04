# Adopting this for your product

This doc is about the decisions the reference docs don't cover: where this repo should live
relative to your product's codebase, how to actually get from "empty fork" to "our story, our
screenshots, our brand," and how to use Claude Code (or another coding agent) to do most of the
mechanical work while you make the editorial calls.

## Where this should live

**Keep it a separate repo from your product, not a folder inside it.** Three reasons:
- Different audience, different reviewers. A PR to your API isn't reviewed by the same person as a
  slide copy change, and mixing them means marketing copy churn shows up in your product's blame
  history (and vice versa).
- Different release cadence. Your product ships continuously; a keynote is a discrete artifact you
  finish, present, and then only occasionally revisit. Tying them to one repo's CI/versioning buys
  you nothing.
- This repo has zero dependency on your product's stack (no framework, no build step) specifically
  so it can outlive a framework migration in the product repo. Folding it in re-couples that.

Fork this repo per **story**, not per product-forever — if you do a big relaunch a year from now,
forking fresh (and cherry-picking media you still want) is usually less friction than un-tangling a
deck that accumulated two years of a product's pivots.

The one exception: if your product IS a static site/app that already deploys as flat files, and you
want the product page (`site/`) to become part of the real marketing site rather than a standalone
demo, copy `site/`'s pattern (the `[data-stage]` iframe-hosting idea) into that site's own codebase
once the deck's content is stable — don't keep serving it from two places.

## The order to actually do this in

Content first, engine second — the four placeholder slides exist to show you the conventions, not
as a shape to fill in mechanically.

1. **Write the story as an outline before touching HTML.** One line per slide, in a scratch file —
   "the problem," "how it works," "proof it works," "what's next." If you can't compress your
   product to 5-8 of these, the deck won't help; fix the pitch first.
2. **Build the deck**, one slide at a time, reusing `docs/design-system.md`'s classes. Verify each
   with `npm run shots -- --only N` before moving to the next — catching an overflow on slide 2
   before you've written slide 6 is a lot cheaper than after.
3. **Swap in real product media.** See "Getting real screenshots in" below — don't let every visual
   be an AI-generated stand-in past your first draft.
4. **Wire `site/`'s stages** to the finished slide list, **cut `short/`'s EDL**, generate voiceover/
   audio if you want them, then export.

Doing this in the other order (scaffold all three surfaces first, then fill content) means you
build and rebuild the site's stage list every time the deck's slide count changes while you're
still figuring out the story.

## Using Claude Code to build this out

The realistic split of labor: **you** decide what the story is and whether a slide is actually
good; **the agent** does the HTML/CSS mechanics of building it to the documented conventions,
writes prompt strings for generation, and catches its own overflow/contrast bugs via the
screenshot loop. That split works because this repo's docs (`design-system.md`,
`pipeline-guide.md`, `assets.md`) exist specifically so you don't have to re-explain the
conventions in every prompt — point the agent at them instead of restating them.

**Two ways to connect it to your product's actual repo, depending on what you need:**

- **You just need the agent to know what your product does** (to write accurate slide copy):
  paste your product's README, a feature list, or a few real screenshots into the conversation, or
  point Claude Code at your product repo in a separate session and ask it to summarize "what this
  product does and its 3 strongest differentiators" — then bring that summary into this repo's
  session as the brief.
- **You need the agent to pull real artifacts from your product** (actual screenshots, a demo
  recording, real copy from your marketing site): open Claude Code **in this repo**, and either
  (a) give it a filesystem path to your product repo/screenshots if they're local, or (b) if your
  product runs locally, ask it to use a browser tool to open your running product, screenshot the
  real UI, and save those images into `assets/images/` — then reference them from a slide exactly
  like a generated asset (`<div class="gen-media"><img src="../assets/images/real-screenshot.png">`).
  This is usually better than generating an AI image of "a dashboard" once you have a real one to
  show — a keynote about your product should mostly show your product.

**A concrete first session**, once you've forked this repo and written your story outline:
> "Here's my story outline: [paste it]. Read docs/design-system.md. Build slide 1 as a cold-open
> title using .display and .a-up staggering, then stop so I can look at it before we do slide 2."

Go slide by slide rather than asking for the whole deck at once — a deck built in one shot tends to
under-vary its layouts (everything becomes a center-aligned title+lead), because nothing forced a
decision about how slide 4 should look *different* from slide 3.

**For voiceover/audio**, the same session can draft `scripts/voiceover-script.mjs` entries once the
deck's copy is final — ask it to write one clean narration sentence per slide matching the deck's
actual on-screen text, not a paraphrase of it (paraphrasing means a viewer reading and listening at
once gets two slightly different versions of the same claim).

## Getting real screenshots/video in

`scripts/gen-image.mjs` / `gen-video.mjs` are for atmosphere and transitions — lifestyle photography,
ambient backgrounds, abstract diagram fills. They are **not** a substitute for showing your actual
product. For the slides that make a specific claim about your UI:
- Screenshot the real thing (Playwright, or manually) at a clean, representative state — no debug
  banners, no lorem ipsum, no half-loaded skeleton states — and drop it in `assets/images/`.
- Treat it like any other `.gen-media` asset from a wiring perspective; it just didn't come from
  the generation scripts.
- If you need it cropped differently at different sizes (a phone breakpoint vs. a 4K display
  wanting a different crop of the same source, not just a resize), that's a real feature this
  starter doesn't include — build a responsive art-direction step only once you actually need
  multiple breakpoints; don't add it speculatively.

## Keeping it in sync as your product changes

Because `site/` and `short/` both run the real deck rather than holding their own copy of your
story, the only place that goes stale is `deck/index.html` itself. When a claim in the deck stops
being true (a feature changed, a number moved), fix it once there. Re-run `npm run shots` after any
such edit — it's your fastest way to notice a slide that visually assumed the old state (e.g. a
screenshot of a UI that no longer looks like that).
