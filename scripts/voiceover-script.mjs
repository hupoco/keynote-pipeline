/* The autoplay narration, one entry per story beat. `scripts/gen-voiceover.mjs` reads this and
   writes assets/voiceover/<id>.mp3 — the deck's autoplay driver (not included in this starter's
   minimal engine, see docs/pipeline-guide.md) looks up a clip by id and paces the beat to the
   clip's own length rather than a reading-time guess.

   `id` must match exactly what the autoplay driver looks for — by convention `slide-NN` for a
   plain slide's narration, `slide-NN-2` / `-3` … for a queued follow-up line on the same slide.
   Keep each entry to one clean sentence: a clip's length becomes the pacing, so a run-on sentence
   makes its slide overstay. */
export const VOICEOVER_SCRIPT = [
  { id: 'slide-01', text: "Ship the story, not just the product." },
  { id: 'slide-02', text: "Author your narrative once, as slides — the product page and the teaser both run from it." },
  { id: 'slide-03', text: "The motion engine draws itself: edges connect, nodes arrive, nothing is static." },
  { id: 'slide-04', text: "Fork this. Replace the four slides, and keep everything underneath." },
];
