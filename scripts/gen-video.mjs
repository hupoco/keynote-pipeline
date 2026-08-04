// Generate a short video with the Gemini API (Veo) and save it to assets/generated/.
//
// Usage:
//   node scripts/gen-video.mjs --prompt "slow drifting embers over deep black, subtle orange glow, seamless loop" --out ambient.mp4
//   node scripts/gen-video.mjs -p "..." -o clip.mp4 --aspect 16:9 --model veo-3.0-generate-preview
//
// Env (see .env.example):
//   GEMINI_API_KEY   (required)
//   VIDEO_MODEL      (optional)  — default Veo model id
//
// NOTE: Veo model ids and options change. Verify the current id + params at
//   https://ai.google.dev/gemini-api/docs/video   and set VIDEO_MODEL in .env.
// Veo runs as a long-running operation, so this script polls until it is done.
import './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'generated');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(names, def) {
  const a = process.argv;
  for (const n of names) { const i = a.indexOf(n); if (i !== -1 && a[i + 1]) return a[i + 1]; }
  return def;
}

const prompt = arg(['--prompt', '-p']);
const outName = arg(['--out', '-o']);
const aspect = arg(['--aspect', '-a'], '16:9');
const model = arg(['--model', '-m'], process.env.VIDEO_MODEL || 'veo-3.1-generate-preview');

// Same shared art-direction as gen-image.mjs so stills and motion share ONE look.
// Override/disable via STYLE_SUFFIX in .env; pass --raw to skip for one clip.
// NEVER write "shot on 35mm film" (or any phrase that makes a FORMAT the subject). Veo read that
// as a thing to depict and rendered a literal filmstrip — sprocket holes, edge codes, frame
// numbers, the picture letterboxed in a black border. Negating it ("no sprocket holes, no
// filmstrip edge") DID NOT WORK; measured, the strip came back, because naming a thing to exclude
// it still names it. Only removing the format-as-subject phrase worked.
// The LOOK words are innocent and are back: "film grain" and "filmic color grade" never produced a
// strip. Stripping them too was an overcorrection — it silently changed the house grade, and the
// first clip generated without them read visibly browner than the rest of the deck
// (mean hue 31 against the deck's 38-72). Style drift is a subtler bug than a sprocket hole and
// nobody notices it until a whole slide looks foreign.
// HIGH-KEY IS THE HOUSE SIGNATURE, so it is stated outright: measured across the wired films,
// v-walk3 / v-portal2 / v-future run 8-15% blown highlights, always from a big bright window in
// frame. Warm and enclosed reads as a different deck.
// gen-image.mjs has never shown the filmstrip failure, so its own suffix is deliberately untouched.
const STYLE_SUFFIX = process.env.STYLE_SUFFIX ??
  ' — cinematic anamorphic, fine natural film grain, rich filmic color grade; warm late-afternoon sunlight raking into the room, the background window or opening flaring bright behind the subject — sunlit and inviting, but CLEAN: skin and white fabric still read their true colour, never an orange or sepia wash over the whole frame never cool, grey, clinical or enclosed either; a person seen IN a space with real depth and life going on behind them, not isolated tight on a desk; a single restrained orange (#fe4a0b) accent present as an OBJECT in the scene (a bag, a garment, a tool, a chair) rather than an overall wash; a genuine candid lifestyle moment with real human emotion (not posed, not corporate stock); premium Apple-commercial spirit; shallow depth of field, tactile textures, unhurried slow camera move, generous negative space; photorealistic; the picture fills the whole 16:9 frame edge to edge; no text, no logos, no watermarks, no borders';
const styledPrompt = process.argv.includes('--raw') ? prompt : (prompt || '') + STYLE_SUFFIX;

if (!process.env.GEMINI_API_KEY) { console.error('✗ Set GEMINI_API_KEY in .env'); process.exit(1); }
if (!prompt || !outName) {
  console.error('Usage: node scripts/gen-video.mjs --prompt "..." --out name.mp4 [--aspect 16:9] [--model veo-3.0-generate-preview]');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, outName.endsWith('.mp4') ? outName : outName + '.mp4');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const resolution = arg(['--resolution', '-r']); // e.g. "1080p" | "720p" (Veo 3.1); omitted → API default
console.log(`• Requesting video with "${model}" (${aspect}${resolution ? ', ' + resolution : ''})… this can take a few minutes.`);
let op = await ai.models.generateVideos({
  model,
  prompt: styledPrompt,
  config: { numberOfVideos: 1, aspectRatio: aspect, ...(resolution ? { resolution } : {}) },
});

while (!op.done) {
  process.stdout.write('.');
  await sleep(10000);
  op = await ai.operations.getVideosOperation({ operation: op });
}
process.stdout.write('\n');

const gen = op?.response?.generatedVideos?.[0];
if (!gen?.video) { console.error('✗ No video in response:', JSON.stringify(op.response || op, null, 2)); process.exit(1); }

try {
  await ai.files.download({ file: gen.video, downloadPath: outPath });
} catch (e) {
  // Fallback: some responses expose a signed URI directly.
  const uri = gen.video.uri || gen.video.videoUri;
  if (!uri) throw e;
  const res = await fetch(`${uri}${uri.includes('?') ? '&' : '?'}key=${process.env.GEMINI_API_KEY}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

console.log(`✓ Saved ${path.relative(ROOT, outPath)}`);
console.log(`  → ambient bg:   <video class="slide-bg-video" src="../assets/generated/${path.basename(outPath)}" autoplay muted loop playsinline></video>`);
console.log(`  → framed media: <div class="gen-media glow a-pop" style="--d:.3s"><video src="../assets/generated/${path.basename(outPath)}" autoplay muted loop playsinline></video></div>`);
