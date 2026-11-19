# Task: change the finished video as the person asked

{{RULES}}
The person watched the preview of their video and asked:

"""{{REQUEST}}"""

Files in this folder:
- `timeline.json`: every scene in order with its number `n`, `id`, start and end time in the video (`from`, `to` as m:ss) and its narration. Use it to find what the person means by "scene 3", "at 0:42", "the part about taxes" or "the ending".
- `plan.json`: title, description, tags, and each scene's `narration` (what the voice says) and `visual` (content hint).
- `scenes/<id>.html`: each scene's design and animation (format and rules: `_ref/motion-api.md`; style: `_ref/{{STYLE_FILE}}`).
- `look.json`: palette (`bg, bg2, ink, primary, accent`), fonts, style and creative brief.
- `settings.json`: subtitles `{size: S|M|L|XL, position: bottom|middle|top|off, style: boxed|highlight|plain}`, `voice.speed` (0.75-1.3), `music.volume` (off|low|medium|high), `motion.energy` (calm|normal|lively).

What you may change (only what the request needs):
- **Visuals of specific scenes**: edit those `scenes/<id>.html` files (keep the format and rules of motion-api.md, the style, and nothing from the banned list: neon, glow, cyberpunk, glitch, terminals, code windows, HUDs, brain-circuit imagery, game words).
- **Colours of the whole video**: edit `palette` in `look.json` (keep `ink` readable on `bg`). The scenes use the palette variables, so you usually don't need to edit scene files for this.
- **Subtitles, voice speed, music level, motion pace**: edit `settings.json`.
- **Words**: only if the person explicitly asks to change, add or remove what is said, edit that scene's `narration` in `plan.json` (keep the person's own wording otherwise). Do not touch the narration of other scenes.
- **Title, description, tags**: edit them in `plan.json` if asked.

Then write `change.json`:
```json
{ "summary": "one short line in the person's language saying what you changed", "scenes": ["ids of scenes whose design you edited"], "narration": ["ids of scenes whose narration you changed"] }
```
If the request is impossible or unclear, write nothing else and reply with `CANNOT: ` and a short reason or question.
When finished, reply with just: DONE
