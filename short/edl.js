/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   THE CUT — a minimal edit-decision-list for the teaser.

   Chat's own repo (the production build this starter is extracted from) drives its 60s teaser off
   a frame-accurate EDL of ~90 shots against real footage — every cut timed to a beat grid, every
   seek computed from source frame numbers. That machinery only pays for itself once you have real
   video clips to cut between (see docs/pipeline-guide.md for the idea).

   This starter has no footage yet, so the "cut" here is simpler: how long to hold each deck slide.
   The shape is the same one you'd grow into a real EDL — an ordered list, each entry addressable by
   time — just without the shot/word-card/sfx columns until you actually need them.

   `t`  when this entry starts, seconds (must be non-decreasing)
   `slide`  which deck slide (0-indexed) to be on for this entry
   `hold`  how long to hold it, seconds
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
export const CUT = [
  { t: 0.0, slide: 0, hold: 3.0 },
  { t: 3.0, slide: 1, hold: 3.0 },
  { t: 6.0, slide: 2, hold: 3.0 },
  { t: 9.0, slide: 3, hold: 3.0 },
];

export const DURATION = CUT.length ? CUT[CUT.length - 1].t + CUT[CUT.length - 1].hold : 0;
