// Produce a single, fully self-contained HTML by inlining every locally-referenced
// asset (images/videos under ../assets/...) as a base64 data URI.
// Use this to share ONE portable file that works with no server and no asset folder.
// Usage:  node scripts/embed-assets.mjs   ->   deck/dist/standalone.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECK = path.join(ROOT, 'deck', 'index.html');
const OUT_DIR = path.join(ROOT, 'deck', 'dist');
const OUT = path.join(OUT_DIR, 'standalone.html');

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

// NOTE ON AUDIO, so the next person does not assume this file already handles it: the map above now
// knows audio types, but the deck's narration/SFX/music paths are BUILT AT RUNTIME by string
// concatenation in JS (see the DECK AUDIO and AUTOPLAY blocks), so the src-attribute scan below
// cannot see them and they are NOT inlined. The standalone file therefore still reads audio from
// assets/ on disk — which is why those runtime paths are location-aware (`/dist/` -> `../../`).
// Inlining them would mean injecting a base64 map, which is a real feature, not a MIME-table entry.

let html = fs.readFileSync(DECK, 'utf8');
let n = 0;
// Match src="..." / href="..." that point at local (non-http, non-data) files.
html = html.replace(/(src|href)=("|')([^"']+)\2/g, (m, attr, q, ref) => {
  if (/^(https?:|data:|#|mailto:)/i.test(ref)) return m;
  const abs = path.resolve(path.dirname(DECK), ref);
  if (!fs.existsSync(abs)) { console.warn(`  ! missing: ${ref}`); return m; }
  const ext = path.extname(abs).toLowerCase();
  const type = mime[ext];
  if (!type) return m;
  const b64 = fs.readFileSync(abs).toString('base64');
  n++;
  return `${attr}=${q}data:${type};base64,${b64}${q}`;
});

// Match CSS url(...) references too (e.g. @font-face src) so fonts inline for a truly portable file.
html = html.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, ref) => {
  // %23 is an encoded '#': the grain texture is an inline SVG data-URI whose own markup contains
  // filter='url(%23n)', and this regex matches that inner url() too. Without this it reports a
  // phantom missing asset on every build, which is how you learn to ignore the build output.
  if (/^(https?:|data:|#|%23)/i.test(ref)) return m;
  const abs = path.resolve(path.dirname(DECK), ref);
  if (!fs.existsSync(abs)) { console.warn(`  ! missing (css): ${ref}`); return m; }
  const type = mime[path.extname(abs).toLowerCase()];
  if (!type) return m;
  const b64 = fs.readFileSync(abs).toString('base64');
  n++;
  return `url(${q}data:${type};base64,${b64}${q})`;
});

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`✓ Inlined ${n} asset(s). Wrote ${path.relative(ROOT, OUT)} (${kb} KB) — a single portable file.`);
