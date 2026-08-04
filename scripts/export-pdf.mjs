// Export the deck to a landscape PDF (one slide per page) by capturing each slide
// end-state and laying the frames out for print. Good for sharing a static version.
// Usage:  node scripts/export-pdf.mjs [--wait 4200] [--out keynote.pdf]
// Requires: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECK = path.join(ROOT, 'deck', 'index.html');

function arg(names, def) { const a = process.argv; for (const n of names) { const i = a.indexOf(n); if (i !== -1 && a[i + 1]) return a[i + 1]; } return def; }
const waitMs = parseInt(arg(['--wait', '-w'], '4000'), 10);
const outPdf = path.join(ROOT, arg(['--out', '-o'], 'keynote.pdf'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await page.goto('file://' + DECK);
// If a slide auto-advances itself (a timed hand-off to the next slide), set window.__hold in the
// deck's own script to respect this flag and stay put — otherwise the capture can land mid-transition.
await page.addInitScript(() => { window.__hold = true; });
await page.evaluate(() => { window.__hold = true; });
await page.waitForTimeout(1200);
const count = await page.$$eval('.slide', (els) => els.length);
console.log(`• Capturing ${count} slides…`);

const frames = [];
for (let i = 0; i < count; i++) {
  await page.waitForTimeout(waitMs);
  const buf = await page.screenshot({ type: 'png' });
  frames.push('data:image/png;base64,' + buf.toString('base64'));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  process.stdout.write(`  ${i + 1}`);
}
process.stdout.write('\n');

// Build a print page: one full-bleed 16:9 image per printed page.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: 1920px 1080px; margin: 0; }
  html,body{margin:0;padding:0;background:#000}
  .pg{width:1920px;height:1080px;page-break-after:always;display:block}
  .pg img{width:1920px;height:1080px;object-fit:cover;display:block}
</style></head><body>
  ${frames.map((src) => `<div class="pg"><img src="${src}"></div>`).join('')}
</body></html>`;

const pdfPage = await browser.newPage();
await pdfPage.setContent(html, { waitUntil: 'networkidle' });
await pdfPage.pdf({ path: outPdf, width: '1920px', height: '1080px', printBackground: true, pageRanges: `1-${count}` });
await browser.close();
console.log(`✓ Saved ${path.relative(ROOT, outPdf)}`);
