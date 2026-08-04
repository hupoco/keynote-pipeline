// Generate the deck's sound effects and music beds with ElevenLabs.
//
// Usage:
//   node scripts/gen-audio.mjs --kind sfx            # every sound effect
//   node scripts/gen-audio.mjs --kind music          # every music bed
//   node scripts/gen-audio.mjs                       # both
//   node scripts/gen-audio.mjs --only dive-in,morph   # just these ids (either kind)
//   node scripts/gen-audio.mjs --kind music --only bed-problem
//
// Env (see .env.example):
//   ELEVENLABS_API_KEY  (required) — the SAME key as the voiceover, but it must have the
//                                    sound-effects / music generation permissions enabled.
//
// Endpoints, verified live against this account rather than taken from docs:
//   POST /v1/sound-generation  { text, duration_seconds, prompt_influence } -> audio/mpeg
//   POST /v1/music             { prompt, music_length_ms }                  -> audio/mpeg
// NOTE: /v1/music, /v1/music/compose and /v1/music/generate all returned 200 + identical byte
// counts on probing, i.e. they are aliases today. /v1/music is used as the documented spelling.
//
// Output:
//   assets/sfx/<id>.mp3        + assets/sfx/manifest.json
//   assets/music/<id>.mp3      + assets/music/manifest.json
// Both directories are gitignored (regenerable output, same as assets/voiceover).
import './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SFX, MUSIC, FILM_AMBIENCE, CAPABILITY_BEDS } from './audio-script.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(names, def) {
  const a = process.argv;
  for (const n of names) { const i = a.indexOf(n); if (i !== -1 && a[i + 1]) return a[i + 1]; }
  return def;
}

const apiKey = arg(['--api-key'], process.env.ELEVENLABS_API_KEY);
const kind = (arg(['--kind', '-k'], 'both') || 'both').toLowerCase();
const onlyIds = arg(['--only']);
const onlySet = onlyIds ? new Set(onlyIds.split(',').map((s) => s.trim())) : null;
/* how many takes to audition per SFX. 3 is the sweet spot measured against the first batch: it
   reliably screens out the silent-dud failure without tripling the bill on sounds that come back
   good first time (the loop stops early once a take scores >= 0.9). */
const takes = Math.max(1, parseInt(arg(['--takes'], '3'), 10) || 3);

if (!apiKey) { console.error('✗ Set ELEVENLABS_API_KEY in .env (see .env.example)'); process.exit(1); }
if (!['sfx', 'music', 'ambience', 'both'].includes(kind)) { console.error(`✗ --kind must be sfx | music | ambience | both (got "${kind}")`); process.exit(1); }

// duplicate ids across BOTH lists would collide in the deck's lookup, so check the union
const allIds = [...SFX, ...MUSIC, ...FILM_AMBIENCE, ...CAPABILITY_BEDS].map((x) => x.id);
const dupe = allIds.find((id, n) => allIds.indexOf(id) !== n);
if (dupe) { console.error(`✗ Duplicate id in audio-script.mjs: "${dupe}"`); process.exit(1); }

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${t ? ` — ${t.slice(0, 300)}` : ''}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('audio')) throw new Error(`expected audio, got ${ct}`);
  return Buffer.from(await res.arrayBuffer());
}

const genSfx = (item) => post('https://api.elevenlabs.io/v1/sound-generation', {
  text: item.prompt,
  duration_seconds: item.duration,
  // 0.45: leans on the prompt (these are precise briefs with explicit "no ..." clauses) while
  // leaving the model enough freedom to produce something that sounds real rather than synthetic.
  prompt_influence: 0.45,
});
const genMusic = (item) => post('https://api.elevenlabs.io/v1/music', {
  prompt: item.prompt,
  music_length_ms: item.durationMs,
});

/* ── LEVELLING ────────────────────────────────────────────────────────────────────────────────
   MEASURED, not assumed: the first sample batch came back spanning 20 dB — morph at -34.9 LUFS
   (inaudible) against a music bed at -15.4 (overpowering), with SFX scattered between. Generative
   audio has no reason to be level-consistent, so authored `gain` values in audio-script.mjs are
   meaningless until every file starts from a known baseline. This pass provides that baseline;
   `gain` then does artistic balance on top of it, which is what it was always meant to mean.

   Two different methods on purpose:
     - SFX are short transients. EBU R128 integrated loudness needs several seconds to mean
       anything, so these are PEAK-normalised (volumedetect -> a single volume adjustment), which
       is both predictable and the right treatment for a sound whose attack is the whole point.
     - Music beds are long and continuous, so they get proper two-pass EBU R128 loudnorm.

   ffmpeg is OPTIONAL. Without it the files are still written and still work — they are just less
   even, and the script says so loudly rather than silently shipping a 20 dB spread. */
const SFX_PEAK_DB = -3.0;      /* headroom below full scale for a transient */
const MUSIC_LUFS  = -20.0;     /* a bed that has to sit under a speaking voice */

let ffmpegOk = null;
function haveFfmpeg() {
  if (ffmpegOk !== null) return ffmpegOk;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpegOk = true; }
  catch { ffmpegOk = false; }
  return ffmpegOk;
}
function ff(args) { return execFileSync('ffmpeg', args, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] }); }
/* spawnSync, NOT execFileSync: ffmpeg writes ALL of its analysis (astats, volumedetect, loudnorm,
   silencedetect, Duration) to stderr, and execFileSync returns only stdout on success — so this
   returned an empty string every time the command worked, which silently made every measurement
   null, every candidate a "dud", and every levelling pass a no-op. Both streams, always. */
function ffErr(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

function normalize(file, isMusic) {
  if (!haveFfmpeg()) return null;
  const tmp = file + '.tmp.mp3';
  try {
    let filter;
    if (isMusic) {
      const log = ffErr(['-hide_banner', '-i', file, '-af', `loudnorm=I=${MUSIC_LUFS}:TP=-1.5:print_format=json`, '-f', 'null', '-']);
      const m = log.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
      if (!m) return null;
      const s = JSON.parse(m[0]);
      filter = `loudnorm=I=${MUSIC_LUFS}:TP=-1.5:measured_I=${s.input_i}:measured_TP=${s.input_tp}:measured_LRA=${s.input_lra}:measured_thresh=${s.input_thresh}:offset=${s.target_offset}:linear=true`;
    } else {
      const log = ffErr(['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
      const m = log.match(/max_volume:\s*(-?[\d.]+) dB/);
      if (!m) return null;
      const adjust = SFX_PEAK_DB - parseFloat(m[1]);
      filter = `volume=${adjust.toFixed(2)}dB`;
    }
    ff(['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-af', filter, '-c:a', 'libmp3lame', '-q:a', '4', tmp]);
    fs.renameSync(tmp, file);
    return isMusic ? `${MUSIC_LUFS} LUFS` : `peak ${SFX_PEAK_DB} dBFS`;
  } catch (e) {
    try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch {}
    return null;
  }
}

/* ── TRIMMING ─────────────────────────────────────────────────────────────────────────────────
   MEASURED on the first batch: `type` was 1.36s long with 0.71s of trailing dead air, and
   `dive-in` went silent at 0.88s of a 1.20s clip. A UI sound with 300ms of silence welded to the
   end feels LAGGY even at the right volume, because the file outlives the gesture that triggered
   it. So SFX get their leading and trailing silence removed. Music is left alone — a bed's
   entrance and exit are handled by the deck's crossfade, not by the file's edges. */
function trimSilence(file) {
  if (!haveFfmpeg()) return null;
  const tmp = file + '.trim.mp3';
  try {
    ff(['-hide_banner', '-loglevel', 'error', '-y', '-i', file,
      '-af', 'silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB:'
           + 'detection=peak,areverse,'
           + 'silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB:detection=peak,areverse',
      '-c:a', 'libmp3lame', '-q:a', '4', tmp]);
    const before = fs.statSync(file).size, after = fs.statSync(tmp).size;
    if (!after) { fs.unlinkSync(tmp); return null; }
    fs.renameSync(tmp, file);
    return { before, after };
  } catch { try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch {} return null; }
}

/* ── CANDIDATE SELECTION ──────────────────────────────────────────────────────────────────────
   Generative SFX is stochastic, and one shot is a lottery: the first batch returned `morph` at
   peak -27.6 dBFS / RMS -39 dB — an essentially silent file that no amount of gain would rescue,
   because there was nothing in it. So each SFX is generated N times and the best candidate is
   chosen on measurable criteria, before any levelling (which would mask exactly the defect we are
   screening for).

   Scored on two things that correlate with "this is a usable sound":
     - contentRatio: how much of the clip is NOT silence. Punishes the dead-air failure directly.
     - presence: RMS relative to peak, i.e. is there a real body to the sound or one stray spike.
   And one hard reject: peak below -20 dBFS is a dud generation, not a quiet one. */
function measure(file) {
  if (!haveFfmpeg()) return null;
  const log = ffErr(['-hide_banner', '-i', file, '-af', 'astats=metadata=1,silencedetect=noise=-50dB:d=0.03', '-f', 'null', '-']);
  const peak = parseFloat((log.match(/Peak level dB:\s*(-?[\d.]+)/) || [])[1]);
  const rms = parseFloat((log.match(/RMS level dB:\s*(-?[\d.]+)/) || [])[1]);
  const dur = parseFloat((log.match(/time=\s*(\d+):(\d+):([\d.]+)/) ? null : null)) || null;
  let silence = 0;
  const re = /silence_duration:\s*([\d.]+)/g; let m;
  while ((m = re.exec(log))) silence += parseFloat(m[1]);
  const durM = ffErr(['-hide_banner', '-i', file, '-f', 'null', '-']).match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const duration = durM ? (+durM[1]) * 3600 + (+durM[2]) * 60 + parseFloat(durM[3]) : null;
  if (!isFinite(peak) || !isFinite(rms) || !duration) return null;
  const contentRatio = Math.max(0, Math.min(1, (duration - silence) / duration));
  return { peak, rms, duration, silence, contentRatio };
}
/* The hard reject is for EMPTY, not for QUIET. An earlier -20 dBFS floor rejected all three takes
   of check-pass — a sound whose own brief asks for "a marimba note struck softly", so of course it
   came back quiet. Quiet is what the levelling pass is for; it lifts every SFX to -3 dBFS peak
   regardless. Only a clip with essentially nothing in it is unusable, hence -40 dBFS, and the
   ranking below is what actually chooses between viable takes. */
function score(m) {
  if (!m) return 0;
  if (m.peak < -40) return 0;                       /* nothing there at all */
  if (m.contentRatio < 0.08) return 0;              /* effectively all silence */
  const presence = Math.max(0, Math.min(1, (m.rms - m.peak + 30) / 30));
  return m.contentRatio * 0.65 + presence * 0.35;
}

/* ── SHAPE AUDITION, for music that has to fit a fixed window ─────────────────────────────────────
   The section beds are long textures and a single take is right for them: their failure mode is taste,
   which no metric catches. The FILM STINGERS are a different problem. Each has to enter and leave
   inside an 8-second shot, and that is a measurable property rather than a matter of taste.
   Zenas: "the transition into it and out of it is very abrupt — it feels like I'm getting slapped in
   the face." The prompts were rewritten to ask for a short pickup and a resolution at ~7s, and then
   MEASURED on the first take of each: two of the four ignored the brief outright — film-pii came back
   8.8 dB LOUDER at its head than its body (a cold slam, the exact fault being fixed) and
   film-compliance was flat to within 0.5 dB end to end. Generation is stochastic, so the honest fix is
   to audition against the brief rather than re-roll by hand until something sounds right.
   A good take is quieter at the head than the body (there is something to enter ON) and quieter across
   its resolution window than its body (it ENDS inside the shot instead of being cut off). */
function shapeOf(file, win) {
  const mean = (ss, t) => {
    const m = ffErr(['-ss', String(ss), '-t', String(t), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
      .match(/mean_volume: (-?[0-9.]+) dB/);
    return m ? parseFloat(m[1]) : NaN;
  };
  const head = mean(0, 0.8);
  const body = mean(1.5, Math.max(1, win - 3.5));
  const tail = mean(Math.max(0, win - 1.2), 2.2);
  if ([head, body, tail].some((v) => Number.isNaN(v))) return null;
  return { head, body, tail, pickup: head - body, resolve: tail - body };
}
function scoreShape(sh) {
  if (!sh) return 0;
  /* -1.5 dB is the floor for "audibly lower". Past about -14 dB the head is effectively silent, which
     wastes a second of an eight-second shot — still better than a slam, so it scores, but poorly. */
  const p = sh.pickup, r = sh.resolve;
  const pick = p > -1.5 ? 0 : (p >= -14 ? 1 : 0.35);
  const res = r <= -1.5 ? Math.min(1, -r / 6) : 0;
  return pick * 0.45 + res * 0.55;
}
async function bestShaped(item, gen, tries, tmpDir) {
  if (!haveFfmpeg() || tries <= 1) return { bytes: await gen(item), note: 'single take (no audition)' };
  fs.mkdirSync(tmpDir, { recursive: true });
  let best = null;
  for (let n = 0; n < tries; n++) {
    let bytes;
    try { bytes = await gen(item); } catch (e) { if (n === tries - 1 && !best) throw e; continue; }
    const p = path.join(tmpDir, `${item.id}.shape${n}.mp3`);
    fs.writeFileSync(p, bytes);
    const sh = shapeOf(p, item.shape);
    const s = scoreShape(sh);
    if (!best || s > best.s) best = { s, bytes, sh };
    fs.unlinkSync(p);
    if (s >= 0.85) break;                           /* enters and leaves properly; stop spending calls */
  }
  if (!best) throw new Error('no candidate produced');
  const sh = best.sh;
  return { bytes: best.bytes,
    note: sh ? `best of ${tries} shaped · pickup ${sh.pickup.toFixed(1)} dB · resolve ${sh.resolve.toFixed(1)} dB · score ${best.s.toFixed(2)}`
             : `best of ${tries} shaped` };
}

/* ── BAKE THE WINDOW ENVELOPE ─────────────────────────────────────────────────────────────────────
   The audition above picks the most musical take, but generation will not reliably deliver BOTH a
   pickup and a resolution at high tempo. Measured across four takes each: film-cited landed a perfect
   1.00, while film-roleplay's best resolve was +1.7 dB and film-compliance's -2.3 dB — because
   "relentless at 140 BPM, no let-up" and "comes to rest by about seven seconds" are close to
   contradictory instructions, and the model resolves the conflict by ignoring the ending.
   So the envelope is BAKED rather than hoped for. A very short fade in — long enough to kill the mp3's
   first-frame click, far too short to soften the downbeat the prompt bought — and a real decay across
   the end of the window. The deck then hands back to the section bed against a curve it knows, instead
   of crossfading through music that is still at full motion, which is what made the exit land like a
   cut. The audition still matters: it chooses what plays UNDER the envelope. */
function bakeWindow(file, win) {
  if (!haveFfmpeg()) return null;
  /* IN_DUR was 0.18s — long enough to kill the mp3's first-frame click and nothing more, chosen when
     the prompts still asked for "full energy from the very first beat". They ask for a pickup now, and
     Zenas: "the most jarring ones are all your commercial videos when the background music comes in,
     because it comes in very loud — is there a way to smoothen it out?"
     MEASURED against the bed each one interrupts: film-cited arrived +6.4 dB over bed-engine and
     film-pii +6.8 dB over bed-cap-roleplay, with film-pii's own first two seconds sitting 11 dB above
     its own body — the cold slam the shape audition flagged and I shipped anyway.
     A 1.0s ramp makes a slam impossible by construction: the file cannot start above its own body
     level whatever the take does, so this stops being something to get lucky on. */
  /* THE RAMP ADAPTS TO THE TAKE. A fixed 1.0s still let film-pii arrive +3.1 dB hot, because its own
     head sits 10.6 dB above its body and the spike lands just AFTER a one-second ramp finishes. So
     measure first: a take whose opening is louder than its body gets a longer ramp, up to 2.4s, which
     is the difference between a rule that usually works and one that cannot fail. */
  const sh = shapeOf(file, win);
  const hot = sh && sh.pickup > 0 ? sh.pickup : 0;          /* dB the head sits ABOVE the body */
  const IN_DUR = Math.min(2.4, 1.0 + hot * 0.14);
  const OUT_DUR = 1.9, OUT_AT = Math.max(0.5, win - 1.6);
  const tmp = `${file}.env.mp3`;
  try {
    ffErr(['-y', '-i', file, '-af',
      `afade=t=in:st=0:d=${IN_DUR}:curve=esin,afade=t=out:st=${OUT_AT}:d=${OUT_DUR}:curve=esin`,
      '-codec:a', 'libmp3lame', '-q:a', '2', tmp]);
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 2048) throw new Error('envelope produced nothing');
    fs.renameSync(tmp, file);
    return `enveloped in ${IN_DUR.toFixed(1)}s${hot?` (head was +${hot.toFixed(1)}dB)`:''}, out ${OUT_DUR}s`;
  } catch { try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch {} return null; }
}

async function bestOf(item, gen, tries, tmpDir) {
  if (!haveFfmpeg() || tries <= 1) return { bytes: await gen(item), note: 'single take' };
  fs.mkdirSync(tmpDir, { recursive: true });
  let best = null;
  for (let n = 0; n < tries; n++) {
    let bytes;
    try { bytes = await gen(item); } catch (e) { if (n === tries - 1 && !best) throw e; continue; }
    const p = path.join(tmpDir, `${item.id}.cand${n}.mp3`);
    fs.writeFileSync(p, bytes);
    const m = measure(p);
    const s = score(m);
    if (!best || s > best.s) best = { s, bytes, m };
    fs.unlinkSync(p);
    if (s >= 0.9) break;                            /* good enough; stop spending calls */
  }
  if (!best) throw new Error('no candidate produced');
  if (best.s === 0) throw new Error(`all ${tries} takes were duds (peak below -20 dBFS or all silence)`);
  return { bytes: best.bytes,
    note: `best of ${tries} · content ${(best.m.contentRatio * 100).toFixed(0)}% · peak ${best.m.peak.toFixed(1)} dBFS` };
}

async function run(label, items, outDir, gen, isMusic) {
  const set = onlySet ? items.filter((i) => onlySet.has(i.id)) : items;
  if (!set.length) return { made: 0, failed: 0, skipped: true };
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\n• ${label}: ${set.length} item(s)…`);
  const manifest = {};
  let failed = 0;
  const tmpDir = path.join(outDir, '.candidates');
  for (const item of set) {
    const outPath = path.join(outDir, `${item.id}.mp3`);
    try {
      /* A long section bed is a single take: expensive per call, and its failure mode is taste, which
         no metric catches. An item that declares `shape` (the film stingers) has to enter and leave
         inside a fixed window, which IS measurable — so it gets auditioned against that. SFX are short
         and cheap enough to audition on content. */
      const { bytes, note } = isMusic
        ? (item.shape ? await bestShaped(item, gen, takes, tmpDir)
                      : { bytes: await gen(item), note: 'single take' })
        : await bestOf(item, gen, takes, tmpDir);
      fs.writeFileSync(outPath, bytes);
      const trimmed = isMusic ? null : trimSilence(outPath);
      const levelled = normalize(outPath, isMusic);
      /* after levelling, so loudnorm measures the music rather than the fades */
      const enveloped = item.shape ? bakeWindow(outPath, item.shape) : null;
      const final = measure(outPath);
      manifest[item.id] = { gain: item.gain, bytes: fs.statSync(outPath).size, prompt: item.prompt,
        ...(item.cue ? { cue: item.cue } : {}), ...(item.zone ? { zone: item.zone } : {}),
        ...(final ? { duration: +final.duration.toFixed(2), peakDb: +final.peak.toFixed(1) } : {}) };
      const bits = [`${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`, note];
      if (trimmed) bits.push(`trimmed ${(100 - trimmed.after / trimmed.before * 100).toFixed(0)}%`);
      if (levelled) bits.push(levelled); else if (haveFfmpeg()) bits.push('level pass failed');
      if (enveloped) bits.push(enveloped);
      console.log(`  ✓ ${item.id}.mp3  (${bits.join(' · ')})`);
    } catch (err) { failed++; console.error(`  ✗ ${item.id}: ${err.message}`); }
  }
  try { fs.existsSync(tmpDir) && fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  const mPath = path.join(outDir, 'manifest.json');
  const prior = fs.existsSync(mPath) ? JSON.parse(fs.readFileSync(mPath, 'utf8')) : {};
  fs.writeFileSync(mPath, JSON.stringify({ ...prior, ...manifest }, null, 2) + '\n');
  return { made: set.length - failed, failed, total: set.length };
}

const results = [];
if (kind === 'sfx' || kind === 'both') results.push(['Sound effects', await run('Sound effects', SFX, path.join(ROOT, 'assets', 'sfx'), genSfx, false)]);
if (kind === 'music' || kind === 'both') results.push(['Music beds', await run('Music beds', MUSIC, path.join(ROOT, 'assets', 'music'), genMusic, true)]);
/* Per-capability beds live alongside the section beds and go through the same music path — long
   textures, single take, no shape audition (they have no window to fit, unlike the film stingers). */
if (kind === 'music' || kind === 'both') results.push(['Capability beds', await run('Capability beds', CAPABILITY_BEDS, path.join(ROOT, 'assets', 'music'), genMusic, true)]);
/* Film ambience is a RECORDING, not a composition, so it goes through the sound-effects endpoint and
   the same levelling as the SFX, and lands in assets/sfx/ beside them. It is not a one-shot though —
   it plays for the length of a shot on its own element. Its own run so --only and the summary can
   talk about it separately. */
if (kind === 'sfx' || kind === 'ambience' || kind === 'both') results.push(['Film ambience', await run('Film ambience', FILM_AMBIENCE, path.join(ROOT, 'assets', 'sfx'), genSfx, false)]);

let anyFailed = 0;
console.log('');
for (const [label, r] of results) {
  if (r.skipped) { console.log(`${label}: nothing matched --only`); continue; }
  console.log(`${label}: ${r.made}/${r.total} generated`);
  anyFailed += r.failed;
}
if (anyFailed) { console.error(`\n${anyFailed} item(s) failed — see above.`); process.exit(1); }
console.log('\nThe deck picks these up automatically next time it opens — no other step needed.');
