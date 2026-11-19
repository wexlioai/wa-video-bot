# Task: review the animated scenes like a strict creative director

{{RULES}}
You are reviewing the scenes of an animated video before it is rendered. Be honest and specific: the
person wants work that looks designed and alive, not slides.

Files:
- `critic/input.json`: every scene with its number `n`, `id`, `narration`, `designed` (false = simple fallback, do not score), and `auto_issues` found by automatic checks.
- `critic/sheet-*.jpg`: frames of the scenes. Each scene has two frames labelled like `3a` (early, mid-animation) and `3b` (later, built up). Look at every sheet image.
- `look.json`: the intended look (palette, fonts, style, brief). `_ref/{{STYLE_FILE}}`: the style rules.

Score each designed scene from 1 to 5, where 4 means "good enough to publish" and 5 "excellent":
- composition and balance, nothing cramped or empty by accident;
- legibility (text size, contrast, nothing cut off, nothing under the subtitles at the bottom);
- consistency with the style and the palette;
- variety (not the same layout as its neighbours);
- fit: the visual clearly illustrates what the narration says;
- retention (see `_ref/retention.md`): a strong first frame, something changing every 2-4 s, emphasis on key words, building up rather than dumping, a payoff; a dull or static scene is at most 3;
- the niche rules above, if any (a depiction of a person where none is allowed is an automatic 1);
- banned looks: anything neon or glowing, cyberpunk, glitch, terminal or code-like, HUD, brain-circuit imagery or game words is an automatic 1.
Take `auto_issues` seriously: a scene with text cut off, overlapping text or a script error is at most 3.

Write `critic/review.json`:
```json
{
  "scenes": [ { "id": "s01", "score": 4, "problems": ["short, concrete problems"], "fix": "one or two sentences telling the designer exactly what to change" } ],
  "suggestions": [ { "text": "an improvement the person might like, phrased as a question, e.g. 'Scene 5 holds 30 words on screen: split it into two?'", "scenes": ["s05"] } ]
}
```
Give at most 3 suggestions, only ones that are worth asking about (optional changes of taste, not bugs).
Write only that file. When finished, reply with just: DONE
