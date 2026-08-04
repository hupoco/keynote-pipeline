#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   Export the deck to video — by RECORDING it, not by stringing frames together.

   WHAT WAS WRONG BEFORE. The old pipeline captured frames with CDP Page.startScreencast and
   assembled them with a concat demuxer. Screencast is CHANGE-DRIVEN: it emits when the compositor
   produces, so a near-static slide emits almost nothing and a moving one emits irregularly. Measured
   inside the cited commercial — a 24 fps source, so 24 genuinely new pictures a second exist to
   catch — the old file delivered 4.36 new pictures per second, holds of 3-12 frames, a 600 ms
   longest hold. The film was playing at a fifth of its own frame rate, in lurches. That is the
   "choppy", and it was NOT a container problem: the old file is a flawless 33.333 ms grid, stdev
   exactly 0.000. The motion was discarded before x264 ever saw it.

   Two flags made it worse. --disable-gpu-vsync and --disable-frame-rate-limit let the page's rAF
   free-run at a measured 340.6 fps, decoupling the deck's animation clock from any display cadence
   so the capture sampled it asynchronously. They are deliberately absent below.

   WHAT THIS DOES INSTEAD. One MediaStream carrying BOTH the composited tab and the deck's real audio
   mix, into ONE MediaRecorder. Sync becomes a property of the container rather than something
   reconstructed afterwards — the old script had no alignment step at all: audio t=0 was rec.start(),
   video t=0 was the first screencast frame, and the concat list used only inter-frame DELTAS, so
   frame 0's absolute time was thrown away. Measured static skew across three runs: 21.8 / 27.5 /
   44.7 ms, variable and uncorrected.
   Measured here: 33.64 new pictures/s in that same commercial, longest hold 100 ms, zero frozen
   frames, and the opening film recovers its 24 fps source rate to within 0.3%.

   WHAT THIS IS NOT: sharper. On content-matched static frames the sharpness is a wash, and on one
   crop the old file is marginally sharper. The higher bitrate buys temporal fidelity, not detail.
   The honest claim is smoother motion and correct colour.

   COLOUR was a real defect. The old file shipped pix_fmt=yuvj420p, color_range=pc,
   color_space=bt470bg — a full-range file wearing the BT.601 PAL matrix, primaries and transfer
   unset. Decoded as tagged, an accent red (210,61,88) lands at (197,44,88). Fixed below.

   THE PRICE: HEADFUL ONLY. getDisplayMedia rejects with NotSupportedError in headless Chromium under
   every flag combination tested, so this needs a real window on a live display for the length of the
   deck: the machine cannot be locked, the display cannot sleep, the window cannot be minimised or
   fully occluded, and it cannot run over ssh or in CI. If you need any of that, use
   scripts/export-video-deterministic.mjs — headless and load-independent, but ~5x slower.

     node scripts/export-video.mjs                     # the whole deck -> keynote.mp4
     node scripts/export-video.mjs --from 14 --to 18   # just those slides (1-based, inclusive)
     node scripts/export-video.mjs --probe             # inject flash+beep markers to measure sync
     node scripts/export-video.mjs --conform-only      # re-run only the delivery pass on the master
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv;
const arg = (names, d) => {
  for (const n of [].concat(names)) { const i = argv.indexOf(n); if (i !== -1 && argv[i + 1]) return argv[i + 1]; }
  return d;
};
const flag = (n) => argv.includes(n);

const W       = parseInt(arg(['--width', '-w'], '1920'), 10);
const H       = parseInt(arg(['--height', '-h'], '1080'), 10);
const FPS     = parseInt(arg('--fps', '60'), 10);
const MBPS    = parseInt(arg('--mbps', '40'), 10);        /* recorder target, not a cap */
const CRF     = arg('--crf', '16');
const OUT     = path.resolve(ROOT, arg(['--out', '-o'], 'keynote.mp4'));
const MASTER  = OUT.replace(/\.mp4$/, '-master.mp4');
const FROM    = arg('--from') ? parseInt(arg('--from'), 10) : null;
const TO      = arg('--to') ? parseInt(arg('--to'), 10) : null;
const MIME    = arg('--mime', 'video/mp4;codecs=avc1.640028,mp4a.40.2');
const PAGE    = arg('--page', '/deck/index.html#clean');
const PROBE   = flag('--probe');
const CONFORM = !flag('--no-conform');
const CONFORM_ONLY = flag('--conform-only');
/* Safety cap only — the run normally ends when the deck's own autoplay reports finished. */
const MAXSEC  = parseFloat(arg('--seconds', '900'));
const TAIL_MS = parseInt(arg('--tail', '1500'), 10);

/* The Web Audio graph's own scheduling latency into the MediaStreamDestination. MEASURED, not
   derived: -38 ms on Chrome for Testing 149 / chromium-1228, from an 8-marker probe run. It is a
   calibration constant, so the run asserts the latency it was calibrated against and stops loudly
   rather than degrading silently after a Playwright upgrade — the failure would otherwise have no
   symptom except sound that feels slightly off. */
const ASHIFT  = parseFloat(arg('--audio-shift', '-38')) / 1000;
const CAL_BASE_LATENCY = 0.021333;
const MARK_EVERY = 5, MARK_W = 240, MARK_H = 135;

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.error('x ffmpeg is required (brew install ffmpeg)'); process.exit(1);
}

/* ── a real origin, with real byte ranges ──────────────────────────────────────────────────────
   Not optional, and not cosmetic. A resource Chrome cannot range-request gets an empty `seekable`
   TimeRanges, so the HTML seek algorithm returns immediately — which leaves all four capability
   commercials sitting on frame one behind a CSS pan that makes them look alive. The old handler
   advertised Accept-Ranges and then answered every request with a 200 and the whole file. */
const MIMES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.otf': 'font/otf', '.ttf': 'font/ttf',
  '.json': 'application/json', '.webm': 'video/webm' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  /* The headful browser asks for this and the deck has none. Answering 204 rather than 404 keeps the
     export's console clean — an unexplained error line in a shipping tool invites someone to go
     hunting for a problem that isn't there. */
  if (rel === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  const stat = fs.statSync(file);
  const type = MIMES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
                       'Content-Length': stat.size, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const errs = [];

if (!CONFORM_ONLY) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;

  console.log(`\n  Recording ${W}x${H} @${FPS}fps, ${MBPS} Mbps target${PROBE ? ', with sync probe' : ''}`);
  console.log('  HEADFUL: leave the window alone and stop the display sleeping until it finishes.\n');

  const browser = await chromium.launch({
    headless: false,                                 /* mandatory — getDisplayMedia needs a display */
    args: [
      '--auto-accept-this-tab-capture',              /* the only capture flag needed */
      '--allow-http-screen-capture',
      /* NOT --use-fake-ui-for-media-stream: makes every getDisplayMedia call fail NotReadableError.
         NOT --auto-select-tab-capture-source-by-title: lets a bare video:true resolve to the monitor.
         NOT --disable-gpu-vsync / --disable-frame-rate-limit: measured to free-run rAF at 340 fps,
         which is a CAUSE of the unnatural motion rather than a cure for it. */
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      `--window-size=${W},${H}`,
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  /* WHAT gets recorded. Defaults to the deck, byte-identically to before this line existed — the
     60-second short passes --page /short/index.html#clean. It implements the same contract this
     script polls (#autobtn[aria-pressed] and .slide.active), so nothing else here changes. */
  await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const setup = await page.evaluate(async ({ W, H, FPS, MBPS, MIME, PROBE, MAXSEC, MARK_EVERY, MARK_W, MARK_H }) => {
    const log = [];

    /* ── AUDIO: the deck's real mix, tapped into one destination ─────────────────────────────
       window.Audio is patched BEFORE autoplay starts, because the SFX pool builds its elements
       lazily on first play — a tap over only the elements present at load misses every sound. */
    const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'playback' });
    const dest = ac.createMediaStreamDestination();
    const tapped = new WeakSet();
    window.__tap = (el) => {
      if (!el || tapped.has(el)) return; tapped.add(el);
      try { const s = ac.createMediaElementSource(el); s.connect(dest); s.connect(ac.destination); } catch {}
    };
    document.querySelectorAll('audio').forEach(window.__tap);
    const NativeAudio = window.Audio;
    window.Audio = function (...a) { const el = new NativeAudio(...a); window.__tap(el); return el; };
    window.Audio.prototype = NativeAudio.prototype;

    /* Keep-alive. Without it the graph idles and the destination's track stops producing samples —
       a 3 minute run produced a 3.99 s audio track against 181 s of picture. */
    const ka = ac.createConstantSource(), kg = ac.createGain();
    kg.gain.value = 1e-7; ka.connect(kg); kg.connect(dest); ka.start();
    if (ac.state === 'suspended') await ac.resume();
    log.push(`audio: ${ac.state} @${ac.sampleRate}Hz baseLatency=${ac.baseLatency.toFixed(6)} keep-alive on`);

    /* ── SYNC PROBE (measurement only) ──────────────────────────────────────────────────────
       A white patch and a 3 kHz burst fired from the SAME AudioContext clock, so the offset in the
       finished file is measurable rather than asserted. The flash flips inside rAF and records the
       audio time at which it flipped, so the in-page request-to-vsync bias can be subtracted. */
    window.__markers = [];
    if (PROBE) {
      const patch = document.createElement('div');
      patch.style.cssText = `position:fixed;left:0;top:0;width:${MARK_W}px;height:${MARK_H}px;` +
                            'background:#000;z-index:2147483647;pointer-events:none';
      document.documentElement.appendChild(patch);
      const t0 = ac.currentTime + 3, targets = [];
      for (let t = t0; t < t0 + MAXSEC - 4; t += MARK_EVERY) targets.push(t);
      for (const when of targets) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = 3000;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.7, when + 0.0015);
        g.gain.setValueAtTime(0.7, when + 0.0375);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.0400);
        o.connect(g); g.connect(dest); o.start(when); o.stop(when + 0.06);
      }
      let k = 0;
      (function raf() {
        const now = ac.currentTime;
        if (k < targets.length && now >= targets[k]) {
          patch.style.background = '#fff';
          window.__markers.push({ k, target: targets[k], acAtFlip: now });
          k++;
          setTimeout(() => { patch.style.background = '#000'; }, 100);
        }
        requestAnimationFrame(raf);
      })();
      log.push(`probe: ${targets.length} markers, first at ac=${t0.toFixed(3)}s, every ${MARK_EVERY}s`);
    }

    /* ── VIDEO: capture of THIS tab ─────────────────────────────────────────────────────────── */
    const disp = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: FPS, max: FPS }, width: { ideal: W, max: W }, height: { ideal: H, max: H } },
      audio: false, preferCurrentTab: true, selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude', systemAudio: 'exclude', monitorTypeSurfaces: 'exclude',
    });
    const vt = disp.getVideoTracks()[0];
    try {
      await vt.applyConstraints({ width: { exact: W }, height: { exact: H },
                                  frameRate: { ideal: FPS, max: FPS }, resizeMode: 'none' });
    } catch (e) { log.push('applyConstraints FAILED: ' + e.message); }
    const st = vt.getSettings();
    log.push(`video track: ${st.width}x${st.height} @${st.frameRate} surface=${st.displaySurface}`);

    /* ── ONE stream, ONE recorder — this is the whole point ─────────────────────────────────── */
    const mixed = new MediaStream([vt, ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(mixed, { mimeType: MIME, videoBitsPerSecond: MBPS * 1e6, audioBitsPerSecond: 256000 });
    log.push(`recorder: ${rec.mimeType} v=${rec.videoBitsPerSecond} a=${rec.audioBitsPerSecond}`);

    const chunks = []; let bytes = 0;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) { chunks.push(e.data); bytes += e.data.size; } };
    rec.onerror = (e) => { window.__recErr = String(e.error || e); };
    window.__recErr = null;
    window.__recBytes = () => bytes;
    window.__nChunks = () => chunks.length;
    /* ── THE CHUNK HAND-OFF RUNS IN A WORKER ────────────────────────────────────────────────
       This used to happen on the page's MAIN THREAD: read a multi-megabyte Blob, build a JS string
       from it in a synchronous 32KB loop, then btoa the whole thing. At 50 Mbps a two-second chunk
       is ~12.5 MB in and ~17 MB of base64 out, and it ran every two seconds for the length of the
       recording — blocking rAF and the compositor while it worked.

       Measured before this change, on every single run regardless of the requested frame rate:
       a `max` frame interval of ~1004 ms — a full second of the film with no frame captured — and
       an actual delivered rate of ~39 fps against a requested 60. Requesting 48 or 120 changed
       nothing, because the bottleneck was never the frame rate.

       A Blob is structured-cloneable, so it costs nothing to hand to a worker. The main thread now
       does no CPU work for the transfer at all. */
    const workerSrc = `onmessage = async (e) => {
      const b = new Uint8Array(await e.data.blob.arrayBuffer());
      let s = '';
      for (let j = 0; j < b.length; j += 0x8000) s += String.fromCharCode.apply(null, b.subarray(j, j + 0x8000));
      postMessage({ id: e.data.id, b64: btoa(s) });
    };`;
    const wk = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
    const pending = new Map();
    let wkSeq = 0;
    wk.onmessage = (e) => { const r = pending.get(e.data.id); if (r) { pending.delete(e.data.id); r(e.data.b64); } };
    window.__chunkB64 = (i) => new Promise((res) => {
      const id = ++wkSeq;
      pending.set(id, res);
      wk.postMessage({ id, blob: chunks[i] });
    });
    /* Released as the run proceeds. Holding every Blob to the end costs ~3.9 MB per second of wall
       clock — 1.5-1.9 GB resident for a full deck, then base64 out with 33% transit inflation.
       Draining keeps steady-state residency around 20 MB. */
    window.__release = (i) => { chunks[i] = null; };

    window.__done = new Promise((res) => { rec.onstop = () => res(true); });
    /* Stop the RECORDER first and let it flush, and only THEN kill the track. Doing both in one
       statement truncated the audio stream by up to 255 ms, which on a run that ends naturally
       rather than on a time cap can clip the closing narration line. */
    window.__stop = async (tailMs) => {
      await new Promise((r) => setTimeout(r, tailMs));
      if (rec.state !== 'inactive') rec.stop();
      await window.__done;
      vt.stop();
    };

    /* independent cadence instrumentation: the same track through a hidden <video>, counted with
       requestVideoFrameCallback, so capture cadence reads separately from encoder output */
    const v = document.createElement('video');
    v.srcObject = new MediaStream([vt]); v.muted = true;
    v.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px';
    document.body.appendChild(v); await v.play().catch(() => {});
    window.__vfc = [];
    const tick = (now, meta) => { window.__vfc.push(meta.mediaTime); if (window.__vfc.length < 200000) v.requestVideoFrameCallback(tick); };
    v.requestVideoFrameCallback(tick);

    /* 4s, not 2s — half as many hand-offs for the same bytes. With the base64 off the main thread
       the cost per hand-off is small, but each one is still a CDP round trip. */
    rec.start(4000);
    return { log, baseLatency: ac.baseLatency };
  }, { W, H, FPS, MBPS, MIME, PROBE, MAXSEC, MARK_EVERY, MARK_W, MARK_H });

  setup.log.forEach((l) => console.log('   ' + l));

  /* The -38 ms shift was calibrated against this latency. If the browser changes it the shift is
     silently wrong, and the only symptom is sound that feels slightly off — so stop instead. */
  if (ASHIFT && Math.abs(setup.baseLatency - CAL_BASE_LATENCY) > CAL_BASE_LATENCY * 0.2) {
    console.error(`\nx AudioContext.baseLatency is ${setup.baseLatency.toFixed(6)}s, but --audio-shift ` +
                  `${(ASHIFT * 1000).toFixed(0)}ms was calibrated at ${CAL_BASE_LATENCY}s.`);
    console.error('  Re-measure with --probe and pass the new value, or --audio-shift 0 to skip.');
    process.exit(1);
  }

  /* dispatched in-page, not page.click(): clean mode makes the button display:none by design */
  if (FROM) await page.evaluate((n) => window.__go(n - 1), FROM);
  await page.evaluate(() => document.getElementById('autobtn').click());

  const fd = fs.openSync(MASTER, 'w');
  let drained = 0;
  async function drain() {
    const n = await page.evaluate(() => window.__nChunks());
    while (drained < n) {
      const b64 = await page.evaluate((i) => window.__chunkB64(i), drained);
      fs.writeSync(fd, Buffer.from(b64, 'base64'));
      await page.evaluate((i) => window.__release(i), drained);
      drained++;
    }
  }

  const t0 = Date.now();
  let stopReason = 'time cap';
  for (;;) {
    await page.waitForTimeout(500);
    const el = (Date.now() - t0) / 1000;
    if (el >= MAXSEC) break;
    const s = await page.evaluate(() => ({
      on: document.getElementById('autobtn').getAttribute('aria-pressed') === 'true',
      n: [...document.querySelectorAll('.slide')].indexOf(document.querySelector('.slide.active')) + 1,
      b: window.__recBytes(), f: window.__vfc.length,
    }));
    await drain();
    if (TO && s.n > TO) { stopReason = `passed slide ${TO}`; break; }
    if (!s.on) { stopReason = 'deck finished'; break; }
    if (Math.round(el * 2) % 20 === 0) {
      console.log(`   ...${el.toFixed(0)}s  slide ${s.n}  ${(s.b / 1e6).toFixed(1)}MB  ` +
                  `${(s.b * 8 / 1e6 / el).toFixed(1)} Mbps  ${s.f} frames (${(s.f / el).toFixed(1)} fps)`);
    }
  }
  const wall = (Date.now() - t0) / 1000;

  const fin = await page.evaluate(async (tail) => {
    await window.__stop(tail);
    return { n: window.__nChunks(), bytes: window.__recBytes(), vfc: window.__vfc,
             markers: window.__markers, err: window.__recErr };
  }, TAIL_MS);
  await drain();                                    /* whatever the final flush produced */
  fs.closeSync(fd);
  await ctx.close(); await browser.close(); server.close();

  console.log(`\n- stopped: ${stopReason} after ${wall.toFixed(1)}s (+${TAIL_MS}ms tail)`);
  console.log(`- recorder error: ${fin.err || 'none'}`);
  console.log(`- master ${path.basename(MASTER)}  ${(fs.statSync(MASTER).size / 1e6).toFixed(1)} MB  ` +
              `= ${(fs.statSync(MASTER).size * 8 / 1e6 / wall).toFixed(1)} Mbps  (${drained} chunks streamed)`);

  const vfc = fin.vfc;
  if (vfc.length > 10) {
    const d = []; for (let i = 1; i < vfc.length; i++) d.push((vfc[i] - vfc[i - 1]) * 1000);
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    const nominal = 1000 / FPS;
    const on = d.filter((x) => Math.abs(x - nominal) <= 1.5).length;
    const s = [...d].sort((a, b) => a - b);
    /* WHERE the worst gap is matters more than how big it is. A one-second hole in the middle of the
       film is a defect; the same hole while a static end card is on screen is the capture correctly
       producing nothing because nothing changed. Report the position so the two are never confused. */
    let worstAt = 0, worst = 0;
    for (let i = 1; i < vfc.length; i++) {
      const g = (vfc[i] - vfc[i - 1]) * 1000;
      if (g > worst) { worst = g; worstAt = vfc[i - 1]; }
    }
    const big = d.filter((x) => x > 200).length;
    const where = [];
    for (let i = 1; i < vfc.length; i++) {
      const g = (vfc[i] - vfc[i - 1]) * 1000;
      if (g > 200) where.push(`${vfc[i - 1].toFixed(1)}s:${g.toFixed(0)}ms`);
    }
    if (where.length) console.log('  gaps: ' + where.join('  '));
    console.log(`- worst gap ${worst.toFixed(0)}ms at t=${worstAt.toFixed(1)}s of ${vfc[vfc.length-1].toFixed(1)}s` +
                `   gaps over 200ms: ${big}`);
    console.log(`- capture cadence (${vfc.length} frames): mean ${mean.toFixed(2)}ms ` +
                `(${(1000 / mean).toFixed(2)} fps) sd ${sd.toFixed(2)}ms  p95 ${s[Math.floor(s.length * .95)].toFixed(2)}  ` +
                `max ${s[s.length - 1].toFixed(0)}  on-cadence ${(on / d.length * 100).toFixed(1)}%`);
    /* A long hold on a static reading slide is a HELD frame, not dropped motion. Anyone who measures
       a static section and sees 10 fps will file it as a regression; it is correct behaviour. */
  }
  if (fin.markers.length) {
    fs.writeFileSync(OUT.replace(/\.mp4$/, '-markers.json'), JSON.stringify(fin.markers, null, 1));
    const bias = fin.markers.map((m) => (m.acAtFlip - m.target) * 1000);
    console.log(`- ${fin.markers.length} sync markers; in-page request-to-flip bias ` +
                `mean ${(bias.reduce((a, b) => a + b, 0) / bias.length).toFixed(2)}ms`);
  }
}

/* ── DELIVERY ───────────────────────────────────────────────────────────────────────────────────
   One conform pass on honest timestamps. -fps_mode cfr duplicates a held frame at exact grid
   positions; it is a formality here, not a rescue. Colour is tagged explicitly. Audio is
   stream-copied — the recorder already wrote AAC-LC 48 kHz and re-encoding would be a second lossy
   generation for nothing. No -shortest: it HIDES a length mismatch, so the mismatch is asserted
   below instead. And no -tune stillimage: measured worse on this content (6.3 Mbps at SSIM 0.97789
   against 5.7 at 0.97838) and twice as slow. */
if (!fs.existsSync(MASTER)) { console.error(`x no master at ${MASTER}`); process.exit(1); }
if (CONFORM) {
  console.log('- conforming to CFR and encoding delivery master...');
  const t = Date.now();
  const r = spawnSync('ffmpeg', ['-y',
    ...(ASHIFT ? ['-itsoffset', ASHIFT.toFixed(4)] : []), '-i', MASTER, '-i', MASTER,
    '-map', '1:v:0', '-map', '0:a:0',
    '-fps_mode', 'cfr', '-r', String(FPS),
    '-vf', 'scale=in_range=tv:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
    '-x264-params', `keyint=${FPS * 2}:min-keyint=${FPS}:aq-mode=3`,
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'copy', '-movflags', '+faststart', '-tag:v', 'avc1', OUT],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error('x ffmpeg conform failed:\n' + (r.stderr || '').slice(-2000)); process.exit(1); }
  console.log(`- ${path.basename(OUT)}  ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB  ` +
              `(encoded in ${((Date.now() - t) / 1000).toFixed(1)}s)`);
} else {
  fs.copyFileSync(MASTER, OUT);
  console.log(`- ${path.basename(OUT)} = master (no conform)`);
}

/* ffprobe writes some of its analysis to stderr — read BOTH streams or a measurement silently
   comes back NaN. That has bitten this repo before. */
const dur = (f, stream) => {
  const p = spawnSync('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries',
    'stream=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  return parseFloat(((p.stdout || '') + (p.stderr || '')).trim()) || 0;
};
const dv = dur(OUT, 'v:0'), da = dur(OUT, 'a:0');
console.log(`- streams: video ${dv.toFixed(3)}s  audio ${da.toFixed(3)}s  delta ${Math.round(Math.abs(dv - da) * 1000)}ms`);
if (Math.abs(dv - da) > 0.3) {
  console.warn(`! A/V LENGTH MISMATCH ${(Math.abs(dv - da) * 1000).toFixed(0)}ms — the closing line may be clipped.`);
}
if (errs.length) console.log('- page errors:', [...new Set(errs)].slice(0, 5).join(' | '));
