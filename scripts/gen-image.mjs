// Generate an image with the Gemini API and save it to assets/generated/.
//
// Usage:
//   node scripts/gen-image.mjs --prompt "a warm abstract orange energy field, cinematic" --out slide05-bg.png
//   node scripts/gen-image.mjs -p "..." -o hero.png --aspect 16:9 --model imagen-4.0-generate-001
//
// Env (see .env.example):
//   GEMINI_API_KEY   (required)  — from https://aistudio.google.com/apikey
//   IMAGE_MODEL      (optional)  — default image model id
//
// NOTE: Image model ids change over time. Verify the current id at
//   https://ai.google.dev/gemini-api/docs/imagen   (Imagen)  or
//   https://ai.google.dev/gemini-api/docs/image-generation  (Gemini native image)
// and set IMAGE_MODEL in .env. This script tries the dedicated Imagen API first
// (ai.models.generateImages) and falls back to Gemini native image via generateContent.
import './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'generated');

function arg(names, def) {
  const a = process.argv;
  for (const n of names) {
    const i = a.indexOf(n);
    if (i !== -1 && a[i + 1]) return a[i + 1];
  }
  return def;
}

const prompt = arg(['--prompt', '-p']);
const outName = arg(['--out', '-o']);
const aspect = arg(['--aspect', '-a'], '16:9');
// Default to Gemini native image ("Nano Banana") — it renders far more cinematic,
// textured, Apple-ad-grade lifestyle imagery than Imagen. Pass -m imagen-4.0-generate-001
// to use the Imagen path instead. (Env IMAGE_MODEL only steers the Imagen fallback.)
const model = arg(['--model', '-m'], 'gemini-2.5-flash-image');

// Shared art-direction so every generated asset shares ONE Apple-commercial look.
// Override or disable via STYLE_SUFFIX in .env (set STYLE_SUFFIX= to turn off);
// pass --raw on the CLI to skip it for a single generation.
const STYLE_SUFFIX = process.env.STYLE_SUFFIX ??
  ' — shot on 35mm film, Kodak Portra 400, cinematic anamorphic lens, fine natural film grain and organic texture; soft directional golden-hour or window light with gentle rim light and long shadows; rich filmic color grade, warm authentic skin tones, muted palette with a single restrained orange (#fe4a0b) accent occurring naturally in the scene; a genuine candid lifestyle moment with real human emotion and imperfection — NOT posed, NOT corporate stock, NOT sterile; editorial advertising photography in the spirit of a premium Apple "Shot on iPhone" commercial; shallow depth of field with creamy natural bokeh; tactile real-world materials and atmosphere (dust motes, steam, reflections); generous cinematic negative space; photorealistic, no text, no logos, no watermarks, no plastic over-retouched skin, no flat even lighting';
const useRaw = process.argv.includes('--raw');
const styledPrompt = useRaw ? prompt : (prompt || '') + STYLE_SUFFIX;

if (!process.env.GEMINI_API_KEY) { console.error('✗ Set GEMINI_API_KEY in .env'); process.exit(1); }
if (!prompt || !outName) {
  console.error('Usage: node scripts/gen-image.mjs --prompt "..." --out name.png [--aspect 16:9] [--model imagen-4.0-generate-001]');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, outName.endsWith('.png') ? outName : outName + '.png');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function saveBytes(b64) {
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  console.log(`✓ Saved ${path.relative(ROOT, outPath)}`);
  console.log(`  → insert into a slide as: <div class="gen-media glow a-pop" style="--d:.3s"><img src="../assets/generated/${path.basename(outPath)}" alt=""></div>`);
}

const isGemini = /gemini/i.test(model);
console.log(`• Generating image with "${model}" (${aspect})${useRaw ? '' : ' · house style'}…`);

// Gemini native image ("Nano Banana"): cinematic; ask for aspect via imageConfig + a prompt hint.
async function viaGemini(m) {
  const res = await ai.models.generateContent({
    model: m,
    contents: `${styledPrompt}\n\nCompose as a single wide ${aspect} horizontal cinematic frame.`,
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
  });
  const img = (res?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!img) throw new Error('no inlineData image in generateContent response');
  return img.inlineData.data;
}
// Imagen path.
async function viaImagen(m) {
  const res = await ai.models.generateImages({ model: m, prompt: styledPrompt, config: { numberOfImages: 1, aspectRatio: aspect } });
  const bytes = res?.generatedImages?.[0]?.image?.imageBytes;
  if (!bytes) throw new Error('no imageBytes in generateImages response');
  return bytes;
}

try {
  saveBytes(isGemini ? await viaGemini(model) : await viaImagen(model));
} catch (err) {
  const fbGemini = process.env.IMAGE_MODEL_NATIVE || 'gemini-2.5-flash-image';
  const fbImagen = process.env.IMAGE_MODEL || 'imagen-4.0-generate-001';
  console.warn(`  "${model}" failed (${err.message}). Falling back to ${isGemini ? fbImagen : fbGemini}…`);
  try {
    saveBytes(isGemini ? await viaImagen(fbImagen) : await viaGemini(fbGemini));
  } catch (err2) {
    console.error(`✗ No image returned (${err2.message}). Check your model id / API access.`);
    process.exit(1);
  }
}
