/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   THE STAGE ENGINE — how the product page shows the product, instead of re-telling it.

   The idea: don't rebuild your deck's set-pieces as separate page markup. Host the REAL deck
   (deck/index.html) in an iframe, pinned to a scroll section, chrome hidden (#clean), and drive it
   from the parent with the one hook the deck already exposes: window.__go(n). Whatever you build in
   the deck — a diagram, a component, a motion sequence — appears on the page for free, and never
   drifts from the deck because it IS the deck.

   Consequences worth knowing before you extend this:
     · SAME ORIGIN ONLY. Reaching into contentWindow across origins throws, so this page must be
       served over http (scripts/serve.mjs), never opened via file://. Byte-range video seeking also
       needs an http origin, so you needed a server anyway.
     · Iframes are built lazily as a stage nears the viewport and torn down once it's far away —
       N simultaneous copies of the deck is a memory leak with a scrollbar, not a page.
     · The deck is authored at a fixed size (see DECK_W/DECK_H below) and is SCALED to fit, never
       reflowed — reflowing a diagram built against a fixed stage is how you break its geometry.
     · Don't reach for a flat "surely enough" sleep after telling a stage to arrive. Poll the actual
       state (a slide's .active class) and reveal the moment it's true; an arbitrary delay is either
       too short (shows a blank frame) or too long (shows a spinner over content that was ready).
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DECK = '../deck/index.html#clean';
  var DECK_W = 1600, DECK_H = 900;             // must match the deck's own authored stage size
  var NEAR = 1.4;   // viewports away at which a stage builds its iframe
  var FAR = 3.0;    // and at which it gives it back (keep well above NEAR — see note in build())

  var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;

  function progress(el) {
    var r = el.getBoundingClientRect(), vh = innerHeight || 1;
    var total = (r.height - vh) || vh;
    return Math.min(1, Math.max(0, -r.top / total));
  }

  /* ── one stage: one pinned section hosting the deck on one slide ─────────────────────────────── */
  function Stage(el) {
    this.el = el;
    this.host = el.querySelector('.stage-frame');
    this.slide = parseInt(el.dataset.slide, 10);
    this.frame = null; this.win = null; this.ready = false; this.arriving = false;
  }

  Stage.prototype.build = function () {
    if (this.frame) return;
    var f = document.createElement('iframe');
    f.className = 'stage-deck';
    f.setAttribute('title', 'product deck');
    f.setAttribute('scrolling', 'no');
    f.setAttribute('tabindex', '-1');
    f.src = DECK;
    this.host.appendChild(f);
    this.frame = f;
    var self = this;
    f.addEventListener('load', function () { self.onload(); });
  };

  Stage.prototype.destroy = function () {
    if (!this.frame) return;
    this.host.removeChild(this.frame);
    this.frame = null; this.win = null; this.ready = false; this.arriving = false;
    this.el.classList.remove('ready');
  };

  Stage.prototype.onload = function () {
    try { this.win = this.frame.contentWindow; } catch (e) { return; }
    var self = this, tries = 0;
    // the deck boots its own engine on DOMContentLoaded; wait for the hook rather than a timer
    (function wait() {
      if (!self.frame) return;
      var ok = false;
      try { ok = self.win && typeof self.win.__go === 'function'; } catch (e) { ok = false; }
      if (!ok) { if (tries++ < 120) setTimeout(wait, 60); return; }
      self.arrive();
    })();
  };

  var POLL = 40, REISSUE = 500, GIVE_UP = 12000;

  Stage.prototype.arrive = function () {
    if (this.arriving || this.ready || !this.win) return;
    this.arriving = true;
    var self = this, w = this.win, t0 = Date.now(), issued = 0;
    if (!isFinite(this.slide)) { this.arriving = false; return; }

    (function step() {
      if (!self.frame) { self.arriving = false; return; }
      if (Date.now() - t0 > GIVE_UP) { self.arriving = false; return; }   // scroll loop retries
      var d;
      try { d = w.document; } catch (e) { self.arriving = false; return; }
      var slides = d.querySelectorAll('.slide');
      if (slides[self.slide] && slides[self.slide].classList.contains('active')) {
        self.ready = true; self.arriving = false;
        self.el.classList.add('ready');
        return;
      }
      if (Date.now() - issued > REISSUE) { issued = Date.now(); try { w.__go(self.slide); } catch (e) {} }
      setTimeout(step, POLL);
    })();
  };

  /* ── the loop ──────────────────────────────────────────────────────────────────────────────── */
  var stages = [].slice.call(document.querySelectorAll('[data-stage]')).map(function (el) { return new Stage(el); });

  // Scale, never reflow — and read width defensively: a page can boot before layout exists
  // (a collapsed pane, a hidden tab), and innerWidth is 0 there. Retry rather than scale to zero.
  function fit() {
    var w = innerWidth || document.documentElement.clientWidth || 0;
    if (!w) { setTimeout(fit, 60); return; }
    var s = Math.min(1, w / DECK_W);
    document.documentElement.style.setProperty('--deck-scale', s);
    document.documentElement.style.setProperty('--deck-h', (DECK_H * s) + 'px');
  }
  fit(); addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement);

  var ticking = false;
  function frame() {
    ticking = false;
    var vh = innerHeight || 1;
    for (var i = 0; i < stages.length; i++) {
      var st = stages[i], r = st.el.getBoundingClientRect();
      var away = r.top > 0 ? r.top / vh : (r.bottom < 0 ? -r.bottom / vh : 0);
      if (away < NEAR) {
        st.build();
        if (st.win && !st.ready && !st.arriving) st.arrive();   // the loop is also the retry
      } else if (away > FAR) st.destroy();
    }
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

  var lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new window.Lenis({ duration: 1.05, smoothWheel: true,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); } });
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
    lenis.on('scroll', onScroll);
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { ticking = false; onScroll(); }
  });
  onScroll();

  var nav = document.getElementById('nav'), hero = document.querySelector('.hero');
  if (nav && hero) new IntersectionObserver(function (es) {
    nav.classList.toggle('on', !es[0].isIntersecting);
  }, { threshold: 0, rootMargin: '-70% 0px 0px 0px' }).observe(hero);

  window.__stages = stages;   // verification hook from devtools: __stages[0].ready etc.
})();
