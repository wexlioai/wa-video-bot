// Shared motion helpers for every scene (window.M). Scenes call them instead of re-inventing moves, so
// motion is consistent across videos, scene code is shorter (less Claude usage) and tested once.
// All helpers add tweens to the timeline you pass and return it. Times are seconds within the scene.
(function () {
  const E = () => (typeof window.E_SCALE === 'number' ? window.E_SCALE : 1);
  const M = {
    /** Rise in from below behind a mask (wrap words/lines in .wm > .w first, or pass any element). */
    rise(tl, target, at, { dur = 0.7, stagger = 0.07, y = 110 } = {}) {
      return tl.from(target, { yPercent: y, opacity: 0, duration: dur, ease: 'power4.out', stagger }, at);
    },
    /** Fade + slide from a side ('left' | 'right' | 'up' | 'down'). */
    slide(tl, target, at, { from = 'left', dist = 70, dur = 0.6, stagger = 0 } = {}) {
      const v = { left: { x: -dist }, right: { x: dist }, up: { y: -dist }, down: { y: dist } }[from] || { x: -dist };
      return tl.from(target, { ...v, opacity: 0, duration: dur, ease: 'power3.out', stagger }, at);
    },
    /** Pop in from its base (props, icons). */
    pop(tl, target, at, { dur = 0.55, origin = '50% 100%', stagger = 0.1 } = {}) {
      return tl.from(target, { scale: 0, transformOrigin: origin, duration: dur, ease: 'back.out(1.8)', stagger }, at);
    },
    /** Draw SVG strokes (paths, lines, circles, polygons) as if inked. */
    draw(tl, target, at, { dur = 1.0, stagger = 0.1, ease = 'power2.inOut' } = {}) {
      const els = gsap.utils.toArray(target);
      els.forEach((el, i) => {
        const len = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 1000;
        tl.fromTo(el, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: dur, ease }, at + i * stagger);
      });
      return tl;
    },
    /** Write text on in reading direction (clip-path reveal). */
    write(tl, target, at, { dur = 0.9, rtl = false } = {}) {
      return tl.fromTo(target, { clipPath: rtl ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0%)', duration: dur, ease: 'power2.inOut' }, at);
    },
    /** Highlighter sweep under words: target needs background-image set (see examples) or use .mk bars. */
    underline(tl, target, at, { dur = 0.6 } = {}) {
      return tl.fromTo(target, { backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%', duration: dur, ease: 'power2.inOut' }, at);
    },
    /** Count a number up inside an element. */
    count(tl, el, at, to, { from = 0, dur = 1.4, decimals = 0, prefix = '', suffix = '', commas = false } = {}) {
      const o = { v: from };
      return tl.to(o, {
        v: to, duration: dur, ease: 'power2.out',
        onUpdate: () => {
          const s = o.v.toFixed(decimals);
          el.textContent = prefix + (commas ? Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s) + suffix;
        },
      }, at);
    },
    /** Rubber stamp / seal landing: the one punchy moment. */
    stamp(tl, target, at, { rot = -12 } = {}) {
      tl.fromTo(target, { opacity: 0, scale: 1.6, rotation: rot - 8, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, rotation: rot, duration: 0.25, ease: 'power4.in' }, at);
      return tl;
    },
    /** Camera move on a container: to { x, y, scale } (origin = transform-origin of the container). */
    camera(tl, cam, at, to, { dur = 1.6, ease = 'power2.inOut' } = {}) {
      return tl.to(cam, { ...to, duration: dur, ease }, at);
    },
    /** A slow continuous drift so a held frame never feels frozen. */
    drift(tl, target, at, until, { x = -30, y = -10, scale = 1.03 } = {}) {
      return tl.to(target, { x: `+=${x}`, y: `+=${y}`, scale, duration: Math.max(0.5, until - at), ease: 'sine.inOut' }, at);
    },
    /** One ring pulse (map cities, points of interest). */
    pulse(tl, target, at, { scale = 2.4, dur = 1.2 } = {}) {
      return tl.fromTo(target, { opacity: 0.9, scale: 0.4, transformOrigin: '50% 50%' }, { opacity: 0, scale, duration: dur, ease: 'power2.out' }, at);
    },
  };
  window.M = M;
})();
