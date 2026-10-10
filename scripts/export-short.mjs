/* ══════════════════════════════════════════════════════════════════════════════════════════════
   EXPORT THE TEASER — a thin front end to export-video.mjs that reads the film's length from the
   cut instead of restating it.

   WHY THIS FILE EXISTS. `export:short` used to be a one-liner in package.json ending in
   `--seconds 12`, and short/edl.js separately derived DURATION from the same cut. Two numbers for
   one fact, and they drift: the production repo this starter was extracted from renders a 60.0s
   film with `--seconds 90`. The failure is asymmetric — too long wastes nothing (the recorder
   stops when the page reports it has finished), too short truncates the ending and you only find
   out once the render is done. So derive it, add a margin, and let the page decide when to stop.

   Every other flag is passed straight through:
     node scripts/export-short.mjs                      # 1920x1080 @60, out short.mp4
     node scripts/export-short.mjs --fps 30 --crf 18
     node scripts/export-short.mjs --seconds 40         # an explicit cap still wins
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);

const { CUT, DURATION } = await import(pathToFileURL(path.join(ROOT, 'short/edl.js')).href);
if (!Number.isFinite(DURATION) || DURATION <= 0) {
  console.error('x short/edl.js exports no usable DURATION — is CUT empty?');
  process.exit(1);
}

/* The cap is a backstop, not the intended length: export-video.mjs stops as soon as the page
   reports window.__autoplay.running === false. 1.5x + 5s leaves room for a slow first paint and
   for a cut that grows a tail, and costs nothing when the page stops on time. */
const cap = Math.ceil(DURATION * 1.5 + 5);

const passthrough = [...argv];
if (!has('--page')) passthrough.push('--page', '/short/index.html#clean');
if (!has('--out') && !has('-o')) passthrough.push('--out', 'short.mp4');
if (!has('--seconds')) passthrough.push('--seconds', String(cap));

console.log(`• the cut is ${DURATION}s over ${CUT.length} entries` +
            (has('--seconds') ? '  (--seconds given, using yours)' : `  → --seconds ${cap} as a cap`));

const child = spawn(process.execPath, [path.join(HERE, 'export-video.mjs'), ...passthrough],
                    { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 1));
