// Render every slide of the deck to a PNG (great for reviewing edits and for the PDF export).
// Usage:
//   node scripts/screenshot.mjs                 # all slides -> assets/shots/
//   node scripts/screenshot.mjs --only 8,10,16  # just these (1-based)
//   node scripts/screenshot.mjs --wait 4200     # ms to wait for each slide's animation to finish
//
// Requires: npx playwright install chromium   (first time only)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECK = path.join(ROOT, 'deck', 'index.html');
const OUT = path.join(ROOT, 'assets', 'shots');

function arg(names, def) { const a = process.argv; for (const n of names) { const i = a.indexOf(n); if (i !== -1 && a[i + 1]) return a[i + 1]; } return def; }
const waitMs = parseInt(arg(['--wait', '-w'], '4000'), 10);
const only = arg(['--only']);
const onlySet = only ? new Set(only.split(',').map((s) => parseInt(s.trim(), 10) - 1)) : null;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await page.goto('file://' + DECK);
// Slide 6 hands itself over to 7 after ~4.8s; without this the capture lands on the wrong slide.
await page.addInitScript(() => { window.__hold = true; });
await page.evaluate(() => { window.__hold = true; });
await page.waitForTimeout(1200);
const count = await page.$$eval('.slide', (els) => els.length);
console.log(`• ${count} slides. Rendering to ${path.relative(ROOT, OUT)}/ …`);

for (let i = 0; i < count; i++) {
  const shoot = !onlySet || onlySet.has(i);
  // jump straight to the slide via the engine hook — robust past explore/dive slides that swallow ArrowRight
  await page.evaluate((n) => (window.__go ? window.__go(n) : null), i);
  await page.waitForTimeout(500);
  if (shoot) {
    await page.waitForTimeout(waitMs);
    const file = path.join(OUT, `slide-${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(`  ✓ slide ${i + 1}`);
  }
}
await browser.close();
console.log('Done.');
