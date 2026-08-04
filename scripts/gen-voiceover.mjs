// Generate the autoplay voiceover with ElevenLabs and save it to assets/voiceover/.
//
// Usage:
//   node scripts/gen-voiceover.mjs                # generate every segment in voiceover-script.mjs
//   node scripts/gen-voiceover.mjs --only slide-01,cap-cited   # regenerate just these ids
//   node scripts/gen-voiceover.mjs --voice-id 21m00Tcm4TlvDq8ikWAM   # override .env for one run
//
// Env (see .env.example):
//   ELEVENLABS_API_KEY     (required)  — from https://elevenlabs.io/app/settings/api-keys
//   ELEVENLABS_VOICE_ID    (required)  — from https://elevenlabs.io/app/voice-library (open a
//                                        voice, the id is in its share link / the API tab)
//   ELEVENLABS_MODEL_ID    (optional)  — default eleven_multilingual_v2
//   ELEVENLABS_OUTPUT_FORMAT (optional) — default mp3_44100_128
//
// NOTE: ElevenLabs' model ids and endpoint shape occasionally change. Verify the current ones at
//   https://elevenlabs.io/docs/api-reference/text-to-speech  before your first run, and set
//   ELEVENLABS_MODEL_ID in .env if the default below has drifted.
//
// What it writes:
//   assets/voiceover/<id>.mp3       one file per segment, named to match voiceover-script.mjs's
//                                    ids EXACTLY — the deck's autoplay driver looks up this same
//                                    filename at runtime, so a renamed id needs a regenerate.
//   assets/voiceover/manifest.json   id -> text, for humans (not read by the deck at runtime;
//                                    the deck learns a clip's length from the audio file itself,
//                                    which is the only thing that can't drift out of sync with it).
import './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICEOVER_SCRIPT } from './voiceover-script.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'voiceover');

function arg(names, def) {
  const a = process.argv;
  for (const n of names) {
    const i = a.indexOf(n);
    if (i !== -1 && a[i + 1]) return a[i + 1];
  }
  return def;
}

const apiKey = arg(['--api-key'], process.env.ELEVENLABS_API_KEY);
const voiceId = arg(['--voice-id'], process.env.ELEVENLABS_VOICE_ID);
const modelId = arg(['--model', '-m'], process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2');
const outputFormat = arg(['--format'], process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128');
const onlyIds = arg(['--only']);
const onlySet = onlyIds ? new Set(onlyIds.split(',').map((s) => s.trim())) : null;

if (!apiKey) { console.error('✗ Set ELEVENLABS_API_KEY in .env (see .env.example)'); process.exit(1); }
if (!voiceId) { console.error('✗ Set ELEVENLABS_VOICE_ID in .env — pick a voice at https://elevenlabs.io/app/voice-library'); process.exit(1); }

const segments = onlySet ? VOICEOVER_SCRIPT.filter((s) => onlySet.has(s.id)) : VOICEOVER_SCRIPT;
if (!segments.length) { console.error('✗ No matching segments (check --only against the ids in voiceover-script.mjs)'); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });

// duplicate ids would silently overwrite one another's audio file — catch it before spending calls
const seen = new Set();
for (const s of VOICEOVER_SCRIPT) {
  if (seen.has(s.id)) { console.error(`✗ Duplicate segment id in voiceover-script.mjs: "${s.id}"`); process.exit(1); }
  seen.add(s.id);
}

async function synthesize(text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(outputFormat)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

console.log(`• Generating ${segments.length} segment(s) with voice ${voiceId} (${modelId})…`);
const manifest = {};
let failed = 0;
for (const seg of segments) {
  const outPath = path.join(OUT_DIR, `${seg.id}.mp3`);
  try {
    const bytes = await synthesize(seg.text);
    fs.writeFileSync(outPath, bytes);
    manifest[seg.id] = { text: seg.text, bytes: bytes.length };
    console.log(`  ✓ ${seg.id}.mp3  (${(bytes.length / 1024).toFixed(0)} KB)  "${seg.text.slice(0, 56)}${seg.text.length > 56 ? '…' : ''}"`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${seg.id}: ${err.message}`);
  }
}

// merge into any existing manifest rather than clobbering entries a --only run didn't touch
const manifestPath = path.join(OUT_DIR, 'manifest.json');
const prior = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
fs.writeFileSync(manifestPath, JSON.stringify({ ...prior, ...manifest }, null, 2) + '\n');

console.log(`\n${segments.length - failed}/${segments.length} generated. Manifest: ${path.relative(ROOT, manifestPath)}`);
if (failed) { console.error(`${failed} segment(s) failed — see above.`); process.exit(1); }
console.log('The deck picks these up automatically next time it opens — no other step needed.');
