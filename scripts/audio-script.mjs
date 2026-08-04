/* Sound effects and music beds. `scripts/gen-audio.mjs` reads these, generates each with
   ElevenLabs (auditioning 3 takes and keeping the best — generation is stochastic), trims dead
   air and levels the result (SFX to -3 dBFS peak, music to -20 LUFS) so the `gain` below means
   something consistent across clips.

   Two lessons worth keeping if you write your own prompts (both measured the hard way):
     - "acoustic" is a different axis from "not mechanical" — a metronomic pulse of plucked notes
       reads as robotic however it's played, so ban the ARTICULATION by name, not just the
       instrument, if you don't want a robotic result.
     - for ambience, never write "sparse" — it's an easy way to get a clip that's mostly silence
       and gets trimmed to almost nothing. Demand density, say "no silence" more than once.

   FILM_AMBIENCE / CAPABILITY_BEDS are left empty here — Chat's own production repo uses them for
   per-scene room tone and per-capability underscore, which only makes sense once you have scenes
   to score. gen-audio.mjs handles empty arrays fine; add entries in the same shape as SFX/MUSIC
   below once you do. */
export const SFX = [
  { id: 'slide-advance', gain: 0.26, cue: 'any plain slide → slide change', duration: 1.2,
    prompt: 'Close-miked recording of one sheet of thick heavy art paper being turned over in a quiet room. A soft breathy sweep of air and fibre, then it settles immediately. Dry, intimate, no room, no reverb, no music, no metallic tone.' },
];

export const MUSIC = [
  { id: 'bed-open', gain: 0.55, zone: [1, 4], durationMs: 30000,
    prompt: 'Spacious warm opening for the first frame of a film. One sustained warm analogue pad opening slowly, a single low piano note struck far apart, faint air and tape warmth. 62 BPM, calm, expectant, quietly hopeful. No percussion of any kind, no drums, no melody, no build. Sits far beneath a narrator.' },
];

export const CAPABILITY_BEDS = [];
export const FILM_AMBIENCE = [];
