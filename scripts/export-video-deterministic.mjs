#!/usr/bin/env node
/* ============================================================================================
   export-A.mjs — a DETERMINISTIC video export for deck/index.html.
   ============================================================================================

   The client's verdict was two complaints that are really one: "choppy … stringing in frames"
   and "audio [not] nicely synced up". Both come from the same root cause — the existing export
   SAMPLES a real-time run. CDP Page.startScreencast is change-driven, so frames arrive at
   irregular instants; MediaRecorder captures the mix on a second real-time clock; and the two
   are related to each other only by hope.

   This script deletes the sampling. Nothing here is real-time.

     ONE VIRTUAL CLOCK.  timeweb (0.3.2, MIT, vendored — dist/timeweb.js) is injected as the very
     first <script> in <head>, before any deck code. It overrides Date.now, performance.now,
     requestAnimationFrame, setTimeout/setInterval, CSS transitions/animations, element.animate()
     and HTMLVideoElement playback. The real browser clock keeps running underneath (which is why
     video seeks still work — Chrome's own Emulation.setVirtualTimePolicy freezes the media
     pipeline and deadlocks them). Frame N is, BY DEFINITION, the page at exactly N/fps seconds.
     There is no capture rate. CFR is not repaired downstream; it is the only thing that can
     be produced.

     THE SAME CLOCK DRIVES THE SOUND.  timeweb virtualises <video> but NOT <audio> — verified:
     with virtual time held at 0, <audio>.currentTime still advanced on wall time, so the deck's
     narration would "end" 2.2x early and the whole mix would tear. So this script installs a
     VIRTUAL AUDIO shim beside timeweb: every <audio> element (including the SFX pool's lazily
     constructed `new Audio()` ones) gets its play/pause/currentTime/duration/ended/timeupdate
     re-expressed as functions of virtual time, and never actually plays. The deck's engine is
     untouched and cannot tell the difference — it still paces narration off `ended`, still
     resumes beds off `currentTime`, still ramps `.volume` on its own 40ms grid.

     Every one of those writes is LOGGED with its virtual timestamp, and the mix is then rebuilt
     offline in Node at 48 kHz, sample by sample. A clip that the deck started at virtual t is
     placed at round(t/1000 * 48000) samples. Frame N is at N/fps seconds. Those are the same
     timeline, so sync is a property of the arithmetic, not an outcome of the run — it cannot
     drift over six minutes because there is no second clock to drift against.

     This is transcription, not prediction. CLAUDE.md warns that "a reconstruction from a timing
     log would drift" — that warning is about PREDICTING the timeline from authored constants
     (dwells are read off measured <video> durations, gates poll at 80ms, readTime() walks live
     innerText). All of that still happens, live, in the browser. We only write down what it did.

   WHY THE AUDIO CAN BE REBUILT AT ALL: every <video> in the deck carries `muted`. Asserted at
   run time below — if a future slide adds an unmuted video, this export must fail loudly rather
   than silently drop its sound.

   USAGE
     node export-A.mjs                          # slide 1, 48s, 1920x1080 -> out/export-A.mp4
     node export-A.mjs --from 7 --seconds 60
     node export-A.mjs --marker                 # + 1-frame white flash & 1kHz click at known
                                                #   virtual times, for objective sync measurement
   ============================================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = '/Users/zenas/Documents/Showcases/Chat/Chat 1.0.0';
const TIMEWEB = path.join(HERE, 'package/dist/timeweb.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

const W       = parseInt(arg('--width', '1920'), 10);
const H       = parseInt(arg('--height', '1080'), 10);
const FPS     = parseInt(arg('--fps', '30'), 10);
const FROM    = parseInt(arg('--from', '1'), 10);
const SECONDS = parseFloat(arg('--seconds', '48'));
const CRF     = arg('--crf', '16');
const OUTDIR  = arg('--outdir', path.join(HERE, 'out'));
const OUT     = path.resolve(arg('--out', path.join(OUTDIR, has('--marker') ? 'export-A-marker.mp4' : 'export-A.mp4')));
const MARKER  = has('--marker');
/* WHAT to render. Defaults to the deck, byte-identically to before this line existed. The 60-second
   short passes --page /short/index.html#clean. */
const PAGE    = arg('--page', '/deck/index.html#clean');
const SR      = 48000;

const MARKER_TIMES_MS = [2000, 20000, 40000];            /* exact frame boundaries at 30 and 60 fps */

fs.mkdirSync(OUTDIR, { recursive: true });
const TMP = fs.mkdtempSync(path.join(OUTDIR, 'work-'));
if (!fs.existsSync(TIMEWEB)) { console.error('✗ vendored timeweb missing at ' + TIMEWEB); process.exit(1); }
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) { console.error('✗ ffmpeg required'); process.exit(1); }

/* ── 1. DURATIONS UP FRONT ────────────────────────────────────────────────────────────────────
   The shim must answer `.duration` synchronously and fire `loadedmetadata` on the next VIRTUAL
   tick, because the deck's playOne() arms its whole beat inside that handler. Probing the file
   in the browser would put a real-time network+decode wait inside the virtual timeline, which is
   exactly the nondeterminism this script exists to remove. So every clip is measured with
   ffprobe first and handed to the page as a table. */
function probeDurations() {
  const map = {};
  /* `short` added: the 60-second short keeps its audio in assets/short/, quarantined from the
     deck's. Without it the shim cannot resolve a duration for any of the short's sounds, play()
     rejects on every one, and the render comes back with perfect picture and complete silence —
     which is exactly what happened the first time this was pointed at the short. */
  for (const dir of ['voiceover', 'sfx', 'music', 'short']) {
    const d = path.join(ROOT, 'assets', dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/\.(mp3|wav|m4a|ogg)$/i.test(f)) continue;
      const abs = path.join(d, f);
      const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', abs], { encoding: 'utf8' });
      const sec = parseFloat((r.stdout || '').trim());
      if (isFinite(sec) && sec > 0) map['/assets/' + dir + '/' + f] = sec;
    }
  }
  return map;
}
process.stdout.write('• probing clip durations… ');
const DUR = probeDurations();
console.log(Object.keys(DUR).length + ' clips');

/* ── 2. THE VIRTUAL AUDIO SHIM (runs in the page, after timeweb, before the deck) ────────────── */
const SHIM = `(function(){
  var LOG=[]; window.__alog=LOG; var DUR=__DURMAP__; var n=1;
  var raw={ vol:Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'volume') };
  function vnow(){ return performance.now(); }              /* virtual — timeweb owns this */
  function log(o){ o.t=vnow(); LOG.push(o); }
  function pathOf(s){ try{ return new URL(s, location.href).pathname; }catch(e){ return null; } }

  function instrument(el){
    if(!el || el.nodeName!=='AUDIO' || el.__vid) return;
    var id = el.__vid = (el.id||'sfx')+'#'+(n++);
    var st={ path:null, dur:0, playing:false, base:0, anchor:0, ended:true, vol:1,
             loop:el.hasAttribute('loop'), tuT:null, endT:null, metaPending:false };
    function cur(){
      if(!st.playing) return st.anchor;
      var t=st.anchor+(vnow()-st.base)/1000;
      if(st.dur>0){ if(st.loop) t=t%st.dur; else if(t>st.dur) t=st.dur; }
      return t;
    }
    function clearT(){ if(st.tuT){clearInterval(st.tuT);st.tuT=null;} if(st.endT){clearTimeout(st.endT);st.endT=null;} }
    function halt(why){
      if(!st.playing){ clearT(); return; }
      var c=cur(); st.anchor=c; st.playing=false; clearT();
      log({ev:'stop',id:id,ct:c,why:why});
    }
    function arm(){
      clearT();
      /* the deck's film stinger fade is driven off timeupdate, so it has to keep ticking —
         250ms is what Chrome itself emits, and on the virtual clock it is exact */
      st.tuT=setInterval(function(){ el.dispatchEvent(new Event('timeupdate')); },250);
      if(!st.loop && st.dur>0){
        st.endT=setTimeout(function(){
          st.endT=null; st.playing=false; st.anchor=st.dur; st.ended=true; clearT();
          log({ev:'stop',id:id,ct:st.dur,why:'ended'});
          el.dispatchEvent(new Event('timeupdate'));
          el.dispatchEvent(new Event('ended'));
        }, Math.max(0,(st.dur-cur())*1000));
      }
    }
    function loadNow(){
      if(st.metaPending) return; st.metaPending=true;
      setTimeout(function(){
        st.metaPending=false;
        if(st.dur>0){ ['loadedmetadata','loadeddata','canplay','canplaythrough'].forEach(function(e){ el.dispatchEvent(new Event(e)); }); }
        else el.dispatchEvent(new Event('error'));
      },0);
    }
    function setSrc(v){
      halt('src'); var p=pathOf(v);
      st.path=p; st.dur=DUR[p]||0; st.anchor=0; st.ended=true; st.rawsrc=v;
      log({ev:'src',id:id,path:p,dur:st.dur});
      loadNow();
    }
    var D=function(name,get,set){ var o={get:get,configurable:true}; if(set)o.set=set; Object.defineProperty(el,name,o); };
    D('src', function(){return st.rawsrc||'';}, setSrc);
    D('currentSrc', function(){return st.rawsrc||'';});
    D('duration', function(){return st.dur||NaN;});
    D('paused', function(){return !st.playing;});
    D('ended', function(){return st.ended;});
    D('readyState', function(){return st.dur>0?4:0;});
    D('networkState', function(){return st.dur>0?1:3;});
    D('seekable', function(){return {length:st.dur>0?1:0,start:function(){return 0;},end:function(){return st.dur;}};});
    D('currentTime', function(){return cur();}, function(v){
      v=+v||0; if(st.dur>0&&v>st.dur) v=st.dur;
      st.anchor=v; st.base=vnow(); if(v<st.dur) st.ended=false;
      log({ev:'seek',id:id,ct:v});
      if(st.playing) arm();
    });
    D('volume', function(){return st.vol;}, function(v){
      v=Math.max(0,Math.min(1,+v||0));
      if(v===st.vol) return;                                 /* the deck writes the same value often */
      st.vol=v; log({ev:'vol',id:id,v:v});
    });
    el.load=function(){ loadNow(); };
    el.play=function(){
      if(!(st.dur>0)){ loadNow(); return Promise.reject(new DOMException('no source','NotSupportedError')); }
      if(st.ended||st.anchor>=st.dur) st.anchor=0;
      st.ended=false; st.base=vnow(); st.playing=true;
      log({ev:'play',id:id,path:st.path,ct:st.anchor,dur:st.dur,loop:st.loop,vol:st.vol});
      arm(); el.dispatchEvent(new Event('play')); el.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    el.pause=function(){ var was=st.playing; halt('pause'); if(was) el.dispatchEvent(new Event('pause')); };
    log({ev:'new',id:id,tag:el.id||''});
  }
  window.__instrumentAudio=instrument;

  /* three doors into an <audio>: parsed markup, document.createElement, and "new Audio()" —
     the SFX pool uses the last one and builds its elements on FIRST PLAY, so patching the
     constructor before the deck's scripts run is the only way to catch a sound effect. */
  new MutationObserver(function(ms){ ms.forEach(function(m){
    [].forEach.call(m.addedNodes,function(nd){
      if(nd.nodeType!==1) return;
      if(nd.nodeName==='AUDIO') instrument(nd);
      else if(nd.querySelectorAll) [].forEach.call(nd.querySelectorAll('audio'),instrument);
    });
  }); }).observe(document.documentElement,{childList:true,subtree:true});
  var ce=document.createElement.bind(document);
  document.createElement=function(t){ var e=ce.apply(null,arguments); if(String(t).toLowerCase()==='audio') instrument(e); return e; };
  var NA=window.Audio;
  window.Audio=function(){ var e=new NA(); instrument(e); if(arguments[0]!=null) e.src=arguments[0]; return e; };
  window.Audio.prototype=NA.prototype;
  document.addEventListener('DOMContentLoaded',function(){ [].forEach.call(document.querySelectorAll('audio'),instrument); });

  /* the marker overlay lives here so it is painted by the same compositor pass as the deck */
  var ov=null;
  window.__mark=function(on){
    if(!ov){ ov=document.createElement('div');
      ov.style.cssText='position:fixed;inset:0;background:#fff;z-index:2147483647;pointer-events:none;display:none';
      document.body.appendChild(ov); }
    ov.style.display = on ? 'block' : 'none';
  };
})();`;

/* ── 3. STATIC SERVER, with the two scripts injected into <head> ──────────────────────────────
   Injection rather than editing deck/index.html: the deck is unversioned and 850KB, and this
   repo has already lost an index.html to a scripted bulk edit. Nothing on disk is touched. */
const TWSRC = fs.readFileSync(TIMEWEB, 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.json': 'application/json', '.webm': 'video/webm' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
  if (rel === PAGE.split('#')[0]) {
    let h = fs.readFileSync(file, 'utf8');
    const inject = '\n<script>' + TWSRC + '</script>\n<script>' +
      SHIM.replace('__DURMAP__', JSON.stringify(DUR)) + '</script>\n';
    const i = h.search(/<head[^>]*>/i);
    if (i === -1) { res.writeHead(500); return res.end('no head'); }
    h = h.slice(0, h.indexOf('>', i) + 1) + inject + h.slice(h.indexOf('>', i) + 1);
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return res.end(h);
  }
  /* REAL BYTE RANGES, not just the header. export-video.mjs advertises Accept-Ranges and then
     answers every request with a 200 and the whole file — which is fine for a pipeline that only
     ever plays forward, and fatal for this one. A resource Chrome cannot range-request ends up
     with an EMPTY `seekable` TimeRanges, and the HTML spec's seek algorithm returns immediately
     when seekable is empty: the assignment is silently discarded. MEASURED without this: timeweb
     wrote 0.0233, 0.0567, 0.0900 … to the film's currentTime and every single read-back was 0.0,
     so all four capability commercials sat on frame one while a CSS pan over the top made them
     look alive. scripts/serve.mjs already says it: "the videos need byte ranges to seek". */
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
    'Content-Length': size, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

/* ── 4. RENDER THE PICTURE ────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--force-device-scale-factor=1',
         '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
         '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: 'load' });

/* waitForFunction is unusable once timeweb is in: it polls via rAF, which is frozen, so it
   deadlocks. Every wait below is a Node-side poll over a real-time sleep instead. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const poll = async (fn, ms = 20000, step = 150) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await sleep(step); }
  return false;
};

if (await page.evaluate(() => typeof window.timeweb) !== 'object') { console.error('✗ timeweb did not attach'); process.exit(1); }

/* THE STANDING ASSERTION. The offline mix is total only while every film is muted — an unmuted
   <video> would contribute sound that no log can see, and the export would silently lose it. */
const unmuted = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.muted && !v.hasAttribute('muted')).length);
if (unmuted) { console.error(`✗ ${unmuted} unmuted <video> — the offline mix cannot see their audio. Aborting.`); process.exit(1); }

/* Real-time waits, taken BEFORE the virtual clock starts moving, so they cost zero output time.
   DO NOT call video.load() here. It looks like a harmless "make sure it is buffered" step and it
   silently freezes every film: load() makes Chrome fire a TRUSTED 'pause', timeweb's own pause
   listener latches paused=true, and from then on its postseek hook skips the element entirely —
   currentTime never advances and all five commercials sit on frame one for the whole export.
   MEASURED: with load(), 1/40 distinct frames over the slide-1 film; without it, the film steps
   by exactly 1/30s a frame. The deck starts slide 1's video during its own init, which is before
   this line runs, so load() was undoing work that had already happened. */
const ready = await poll(() => [...document.querySelectorAll('video')].every((v) => v.readyState >= 3), 60000);
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await sleep(600);
console.log(`• videos ${ready ? 'buffered' : 'NOT fully buffered (continuing)'}; virtual clock at ` +
            `${await page.evaluate(() => performance.now())}ms — nothing has moved yet`);

if (FROM > 1) { await page.evaluate((n) => window.__go(n - 1), FROM); await sleep(400); }
await page.evaluate(() => document.getElementById('autobtn').click());

const N = Math.round(SECONDS * FPS);
const markerFrames = MARKER ? new Set(MARKER_TIMES_MS.filter((m) => m < SECONDS * 1000).map((m) => Math.round(m / 1000 * FPS))) : new Set();

const videoOnly = path.join(TMP, 'picture.mp4');
const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
  /* PNG in is full-range RGB. Convert EXPLICITLY and tag what we did. The shipped
     an exported keynote.mp4 is yuvj420p / color_range=pc / bt470bg — a full-range file wearing the PAL
     matrix, which moves the Hupo red from (210,61,88) to (197,44,88) on any player that reads
     the tags. That is a free defect to fix and it is fixed here. */
  '-vf', 'scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  /* colorprim/transfer/colormatrix go in the SPS VUI via x264 itself; the ffmpeg -color_* flags
     alone left color_primaries and color_transfer as "unknown" in the finished file (measured). */
  '-x264-params', 'keyint=' + (FPS * 4) + ':min-keyint=' + (FPS * 2) + ':aq-mode=3' +
                  ':colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv',
  '-fps_mode', 'cfr', '-r', String(FPS), '-an', videoOnly], { stdio: ['pipe', 'inherit', 'pipe'] });
let ffErr = '';
ff.stderr.on('data', (d) => { ffErr += d; });
const ffDone = new Promise((res) => ff.on('close', res));
const write = (buf) => new Promise((res) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res); });

console.log(`• rendering ${N} frames at ${FPS}fps (${SECONDS}s of output) — frame N IS the page at N/${FPS}s`);
const t0 = Date.now();
const slideAt = [];
let rendered = 0, stoppedEarly = null, bytes = 0, filmFrames = 0, filmMoved = 0, lastFilm = [];
for (let f = 0; f < N; f++) {
  /* goTo() runs every virtual timer, rAF, CSS transition and video seek forward to exactly this
     instant and RESOLVES only once the seeks have landed. Render speed is irrelevant to output
     timing — this can take 20ms or 2s and frame f is still the page at f/FPS. */
  const st = await page.evaluate(async (ms) => {
    await window.timeweb.goTo(ms);
    const sl = [...document.querySelectorAll('.slide')];
    return { vt: performance.now(),
             slide: sl.indexOf(document.querySelector('.slide.active')) + 1,
             on: document.getElementById('autobtn').getAttribute('aria-pressed') === 'true',
             /* a playing film's currentTime must move every single frame — this is the canary for
                the load() trap above, and for any future change that pauses a film by accident */
             film: [...document.querySelectorAll('video')].filter((v) => !v.paused).map((v) => +v.currentTime.toFixed(4)) };
  }, f * 1000 / FPS);
  slideAt.push(st.slide);
  if (st.film.length) { filmFrames++; if (st.film.some((c, k) => lastFilm[k] !== undefined && c !== lastFilm[k])) filmMoved++; }
  lastFilm = st.film;
  if (markerFrames.has(f)) await page.evaluate(() => window.__mark(true));
  const buf = await page.screenshot({ type: 'png' });
  if (markerFrames.has(f)) await page.evaluate(() => window.__mark(false));
  bytes += buf.length;
  await write(buf);
  rendered++;
  if (Math.abs(st.vt - f * 1000 / FPS) > 0.001) { console.error(`✗ virtual clock slipped at frame ${f}: ${st.vt}`); break; }
  if (!st.on && f > FPS * 2) { stoppedEarly = f; break; }   /* deck reached its last slide */
  if (f % (FPS * 5) === 0 && f) {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`  frame ${f}/${N}  slide ${st.slide}  ${(f / el).toFixed(1)} fps wall  eta ${Math.round((N - f) / (f / el))}s\n`);
  }
}
ff.stdin.end();

/* ── 5. PULL THE AUDIO TRANSCRIPT ─────────────────────────────────────────────────────────── */
const alog = await page.evaluate(() => window.__alog);
const RENDER_MS = rendered * 1000 / FPS;
await ctx.close(); await browser.close(); server.close();

console.log(`• ${rendered} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s wall (${(bytes / 1e9).toFixed(2)} GB of PNG streamed, never stored)` +
            (stoppedEarly ? ` — deck ended at frame ${stoppedEarly}` : ''));
console.log(`• film check: ${filmFrames} frames had a film playing, ${filmMoved} of them advanced its currentTime ` +
            `(${filmFrames ? (100 * filmMoved / (filmFrames - 1)).toFixed(1) : '—'}%)` +
            (filmFrames && filmMoved < (filmFrames - 1) * 0.98 ? '  ← A FILM IS FROZEN, see the load() note above' : ''));
const kinds = {}; for (const e of alog) kinds[e.ev] = (kinds[e.ev] || 0) + 1;
console.log(`• audio transcript: ${alog.length} events ${JSON.stringify(kinds)}`);
fs.writeFileSync(path.join(OUTDIR, 'alog.json'), JSON.stringify(alog));

const rc = await ffDone;
if (rc !== 0) { console.error('✗ picture encode failed:\n' + ffErr.slice(-2000)); process.exit(1); }

/* ── 6. REBUILD THE MIX OFFLINE, SAMPLE BY SAMPLE ─────────────────────────────────────────── */
const decoded = new Map();
function decode(p) {                                   /* url pathname -> interleaved f32 stereo @48k */
  if (decoded.has(p)) return decoded.get(p);
  const abs = path.join(ROOT, p.replace(/^\//, ''));
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', abs, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'],
    { maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.warn('  ! could not decode ' + p + ': ' + String(r.stderr).slice(0, 200)); decoded.set(p, null); return null; }
  const b = r.stdout;
  const pcm = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
  decoded.set(p, pcm);
  return pcm;
}

/* per element: an ordered event stream -> segments (one continuous playback of one file) plus a
   volume envelope. Each segment is placed from its OWN absolute virtual timestamp, so an error in
   one cannot propagate into the next: total error is bounded, never cumulative. */
const byEl = new Map();
for (const e of alog) { if (!byEl.has(e.id)) byEl.set(e.id, []); byEl.get(e.id).push(e); }

const segments = [];
const volEvents = new Map();
for (const [id, evs] of byEl) {
  evs.sort((a, b) => a.t - b.t);
  const vols = [];
  let open = null;
  for (const e of evs) {
    if (e.ev === 'vol') { vols.push({ t: e.t, v: e.v }); continue; }
    if (e.ev === 'play') {
      if (open) { open.end = e.t; segments.push(open); }
      open = { id, path: e.path, start: e.t, offset: e.ct, loop: !!e.loop, dur: e.dur, end: null };
    } else if (e.ev === 'stop' && open) { open.end = e.t; segments.push(open); open = null; }
  }
  if (open) { open.end = RENDER_MS; segments.push(open); }
  volEvents.set(id, vols);
}

const totalSamples = Math.ceil((RENDER_MS / 1000) * SR) + SR;      /* +1s tail for a clip still ringing */
const mix = new Float32Array(totalSamples * 2);
let placed = 0, skipped = 0;

for (const s of segments) {
  if (!s.path || s.end <= s.start) continue;
  if (s.start >= RENDER_MS) continue;
  const pcm = decode(s.path);
  if (!pcm) { skipped++; continue; }
  const srcFrames = pcm.length / 2;
  const startSample = Math.round(s.start / 1000 * SR);
  const nFrames = Math.min(Math.round((Math.min(s.end, RENDER_MS + 1000) - s.start) / 1000 * SR),
                           totalSamples - startSample);
  if (nFrames <= 0) continue;
  const offFrames = Math.round(s.offset * SR);

  /* THE GAIN ENVELOPE. The deck ramps `.volume` on its own 40ms setInterval grid, so the truthful
     reproduction is a step at each logged write — with a 2ms linear glide so a genuine hard cut
     (0 -> 0.86 in one write) does not put a click in the master. Over a crossfade the steps are
     ~0.003 apart and the glide is inaudible either way. */
  const vols = volEvents.get(s.id) || [];
  let vi = 0; while (vi < vols.length && vols[vi].t <= s.start) vi++;
  let g = vi > 0 ? vols[vi - 1].v : 1;
  const GLIDE = Math.round(0.002 * SR);
  let ramp = 0, step = 0;

  for (let i = 0; i < nFrames; i++) {
    const tMs = s.start + (i / SR) * 1000;
    while (vi < vols.length && vols[vi].t <= tMs) { const target = vols[vi].v; step = (target - g) / GLIDE; ramp = GLIDE; vi++; }
    if (ramp > 0) { g += step; ramp--; }
    let sf = offFrames + i;
    if (s.loop) { sf %= srcFrames; if (sf < 0) sf += srcFrames; }
    else if (sf >= srcFrames) break;
    const o = (startSample + i) * 2, q = sf * 2;
    mix[o] += pcm[q] * g;
    mix[o + 1] += pcm[q + 1] * g;
  }
  placed++;
}

if (MARKER) {
  /* 1 kHz, 20 ms, at EXACTLY the virtual instant of the flashed frame. Nothing about this marker
     is measured from the run — both halves are written from the same number. */
  for (const m of MARKER_TIMES_MS) {
    if (m >= RENDER_MS) continue;
    const s0 = Math.round(m / 1000 * SR);
    for (let i = 0; i < Math.round(0.02 * SR); i++) {
      const env = Math.min(1, i / 48) * Math.min(1, (0.02 * SR - i) / 48);
      const v = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.7 * env;
      mix[(s0 + i) * 2] += v; mix[(s0 + i) * 2 + 1] += v;
    }
  }
}

let peak = 0; for (let i = 0; i < mix.length; i++) { const a = Math.abs(mix[i]); if (a > peak) peak = a; }
if (peak > 0.999) { const k = 0.999 / peak; for (let i = 0; i < mix.length; i++) mix[i] *= k; }
const rawPath = path.join(TMP, 'mix.f32');
fs.writeFileSync(rawPath, Buffer.from(mix.buffer, 0, mix.length * 4));
console.log(`• mix: ${placed} segments placed (${skipped} undecodable), ${(totalSamples / SR).toFixed(2)}s, peak ${peak.toFixed(3)}${peak > 0.999 ? ' (normalised)' : ''}`);

/* ── 7. MUX ───────────────────────────────────────────────────────────────────────────────── */
const mux = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-i', videoOnly,
  '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', rawPath,
  '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '256k', '-ar', String(SR),
  /* no -shortest: it hides a length mismatch instead of reporting one. The audio is deliberately
     1s longer than the picture and is trimmed to the picture here, explicitly. */
  '-t', (RENDER_MS / 1000).toFixed(6),
  '-movflags', '+faststart', '-tag:v', 'avc1', OUT], { encoding: 'buffer' });
if (mux.status !== 0) { console.error('✗ mux failed:\n' + String(mux.stderr).slice(-2000)); process.exit(1); }

fs.writeFileSync(path.join(OUTDIR, 'slides.json'), JSON.stringify(slideAt));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
console.log(`\n✓ ${OUT}  (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB, ${W}x${H}, ${FPS}fps CFR)`);
if (pageErrors.length) console.log('  page errors:', pageErrors.slice(0, 3).join(' | '));
