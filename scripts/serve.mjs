#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   Serve the showcase.

   The deck is one self-contained file and opens by double-click. The product page cannot: it hosts
   the deck in iframes and reaches into contentWindow, and under file:// every document gets its own
   opaque origin, so that read throws. The videos need byte ranges to seek, which file:// also will
   not serve. So the page needs an HTTP origin — and it needs one that outlives whatever tool
   happened to start it, which is how it went dark last time.

   No dependencies, no install, no network: node ships everything this needs. Double-click
   Preview.command, or run `npm start`.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPEN_AT = process.env.OPEN_AT || '/site/';
const WANT_PORT = +(process.env.PORT || 5179);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

/* The product page opens the same 850 KB deck in a dozen iframes. Under no-store every one of them
   re-downloads it, plus its fonts, images and video, which is the single most wasteful thing this
   server could do. Validate instead of forbidding: the browser asks, we answer 304, and an edit on
   disk still shows up on the next reload because the tag is derived from mtime and size. */
const tagOf = (st) => `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { return send(res, 400, 'bad request'); }

  /* Resolve, then prove the result is still inside ROOT. Path traversal on a local preview server is
     low stakes, but "low stakes" is how a directory ends up published by accident. */
  let file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden');

  let st;
  try { st = fs.statSync(file); } catch { return send(res, 404, 'not found: ' + rel); }
  if (st.isDirectory()) {
    const idx = path.join(file, 'index.html');
    if (!fs.existsSync(idx)) return send(res, 404, 'no index in ' + rel);
    if (!rel.endsWith('/')) return send(res, 301, '', { location: rel + '/' });
    file = idx; st = fs.statSync(file);
  }

  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const etag = tagOf(st);
  /* MEDIA IS IMMUTABLE FOR THE LIFE OF A VISIT. Measured: under `no-cache` every video on the page
     was fetched THREE times — 176 MB of transfer for 49 MB of files — because a revalidating range
     request cannot be served from Chrome's disk cache, so each replay refetches the body. Markup,
     CSS and JS keep revalidating so an edit still shows up on reload; the generated media does not
     change during a session and should be paid for once. */
  const immutable = /\.(mp4|webm|mov|jpg|jpeg|png|webp|woff2?|otf|ttf|mp3|m4a|wav)$/.test(ext);
  const base = { 'content-type': type, 'accept-ranges': 'bytes',
                 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
                 etag, 'last-modified': st.mtime.toUTCString() };

  /* A conditional hit costs one round trip and no bytes. Skip it for range requests — a 304 to a
     partial request confuses some media stacks, and the bytes are what the decoder came for. */
  if (!req.headers.range && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': 'no-cache' });
    return res.end();
  }

  /* Byte ranges. Without these a <video> can load but never seek, and the deck's films are seeked
     constantly by the stage engine. */
  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : st.size - parseInt(m[2], 10);
    let end = m[2] && m[1] ? parseInt(m[2], 10) : st.size - 1;
    start = Math.max(0, start); end = Math.min(st.size - 1, end);
    if (!(start <= end)) {
      return send(res, 416, '', { 'content-range': `bytes */${st.size}` });
    }
    res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${st.size}`,
                         'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...base, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});

/* If the wanted port is taken, take the next one rather than dying — a stale server from an earlier
   run should not be the reason nothing opens. */
function listen(port, tries = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries < 20) return listen(port + 1, tries + 1);
    console.error('could not listen:', e.message); process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}${OPEN_AT}`;
    console.log(`\n  Keynote pipeline preview\n`);
    console.log(`    product page   ${url}`);
    console.log(`    the deck       http://localhost:${port}/deck/index.html`);
    console.log(`    serving        ${ROOT}\n`);
    console.log(`  ctrl-c to stop\n`);
    if (process.env.NO_OPEN !== '1') execFile('open', [url], () => {});
  });
}
listen(WANT_PORT);
