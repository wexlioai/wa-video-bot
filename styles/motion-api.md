# How a scene file works (the motion designer's contract)

Each scene is ONE file `scenes/<scene id>.html` containing exactly three parts, in this order:

```html
<style>
  /* CSS for this scene only. Prefix every selector with .sc (the scene's root element). */
  .sc .hero { ... }
</style>
<div class="sc">
  <!-- the scene's elements: HTML + inline <svg>. No <img>, no external files. -->
</div>
<script>
  // GSAP animation code. Add tweens to the timeline `tl` (already created, paused).
</script>
```

The bot wraps it into a full 1920×1080 (long) or 1080×1920 (Short) composition. It adds the background
colour, fonts, the voice track and the captions itself. **Do not draw captions or narration text.**

## Available in the script
| Name | What it is |
|---|---|
| `tl` | the paused GSAP 3 timeline. Use `tl.from/to/fromTo/set(target, vars, positionInSeconds)`. Always pass an explicit position (a number of seconds). |
| `D` | the scene length in seconds. Everything must finish by `D`. |
| `W`, `H` | canvas size in px (1920×1080 or 1080×1920). |
| `PORTRAIT` | `true` for the Short (9:16). The root also has class `portrait` then, so CSS can use `.portrait .sc …`. |
| `T` | colours: `T.bg, T.bg2, T.primary, T.accent, T.text` (the look's palette; `text` = ink). Also CSS variables `var(--bg)`, `var(--bg2)`, `var(--primary)`, `var(--accent)`, `var(--text)`. |
| fonts | CSS variables `var(--fh)` (heading font) and `var(--fb)` (body font). |
| `E` | pace multiplier (0.7-1.6). Multiply durations by it: `duration: 0.6 * E`. |
| `WORDS` | the narration's words with timing: `[{text, start, end}, …]` in seconds. |
| `at(i)` | start time of word number `i` (0-based). |
| `when('word', after = 0)` | start time of the first word that matches (case/punctuation-insensitive) at or after `after` seconds; falls back to a sensible time if not found. Use this to make things appear exactly when the voice says them. |
| `rand(i)` | deterministic pseudo-random number 0-1 for index `i` (never use `Math.random`). |
| `$('.x')`, `$$('.x')` | querySelector / querySelectorAll inside the scene. |
| `RTL`, `LANG` | `true` / `'ur'` for Urdu (right-to-left). |

## Rules (renders break or look wrong if these are ignored)
1. Deterministic: no `Math.random`, `Date`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `fetch`, infinite `repeat: -1`, or `yoyo` without a finite repeat. The renderer seeks the timeline frame by frame.
2. Every tween has an explicit position and ends at or before `D`. Long "breathing" moves (slow drift, float) may run until `D`.
3. Sync to the voice: an element that illustrates a word or number appears at `when('that word')` (minus about 0.15 s).
4. Safe areas: keep important things 110 px from the edges, and out of the top 100 px (long) / top 240 px (Short), which the bot uses for the progress line and section names. Long: keep the bottom 200 px free for captions. Short: keep the bottom 560 px and top 180 px free.
5. Text on screen: at most about 12 words per scene besides big numbers; never repeat the whole narration.
6. Use only the palette colours (plus white/black with transparency for shadows and paper effects).
7. The scene's own background must cover the full canvas (a full-size element with `position:absolute; inset:0`).
8. Something should always be gently moving while the scene holds (a slow drift, sway or scale), but never jittery.
9. Elements are `position:absolute` inside `.sc`, which is already full size (`position:absolute; inset:0`).
10. For Urdu, text runs right-to-left; use the heading/body font variables.

## Ready-made props
If `_ref/props-<niche>.json` exists, use its props instead of drawing those things yourself:
`<prop name="wax-seal" class="seal" style="position:absolute;left:640px;top:720px;width:120px" text="3 AH"></prop>`.
The bot swaps the tag for the SVG; `class`, `style` and `id` go onto the `<svg>`, other attributes fill the
prop's params. Animate the parts the catalogue lists (`.sc .seal .seal-ring`, `.sc .map .city-medina`…).
Finished examples using props are in `_ref/examples/`.

## Example (very small)
```html
<style>
  .sc .sky { position:absolute; inset:0; background:var(--bg); }
  .sc .jar { position:absolute; left:300px; top:260px; width:360px; height:480px; }
  .sc .ttl { position:absolute; left:820px; top:360px; width:900px; font:800 96px/1.05 var(--fh); color:var(--text); }
  .portrait .sc .jar { left:360px; top:220px; }
  .portrait .sc .ttl { left:110px; top:860px; width:860px; font-size:88px; }
</style>
<div class="sc">
  <div class="sky"></div>
  <svg class="jar" viewBox="0 0 360 480">
    <rect x="40" y="80" width="280" height="380" rx="60" fill="none" stroke="var(--text)" stroke-width="10"/>
    <g class="coins">
      <circle cx="140" cy="400" r="40" fill="var(--accent)"/><circle cx="230" cy="400" r="40" fill="var(--accent)"/>
    </g>
  </svg>
  <div class="ttl">Small savings grow</div>
</div>
<script>
  tl.from('.sc .jar', { y: 60, opacity: 0, duration: 0.7 * E, ease: 'power3.out' }, 0.1);
  tl.from('.sc .coins circle', { y: -400, duration: 0.6 * E, ease: 'bounce.out', stagger: 0.15 }, when('savings') - 0.15);
  tl.from('.sc .ttl', { x: 80, opacity: 0, duration: 0.6 * E, ease: 'power3.out' }, 0.4);
  tl.to('.sc .jar', { rotation: 2, transformOrigin: '50% 100%', duration: D - 1, ease: 'sine.inOut' }, 1);
</script>
```
