# Task: art-direct this video

You are the art director of a motion-graphics studio. The video's narration is already planned. Your job is
to design how this particular video should LOOK, from what the script is about and how it should feel.

Files in this folder:
- `plan.json`: the video plan (title, language, scenes with narration). Read it first.
- `script.txt`: the original script text.
- `_ref/index.json`: the style library. You may only choose styles with `"ready": true`.
- `_ref/<style>.md`: the rules of each ready style. Read the files of the styles you consider.
- `_ref/fonts.json`: the only fonts you may use, with their exact Google Fonts `query`.

{{SAVED}}

{{TASTE}}

## 1. Write `look/brief.json`

```json
{
  "topic": "one line: what the video is about",
  "audience": "who it is for",
  "tone": "3-5 words, e.g. warm, reassuring, practical",
  "arc": "the emotional journey in one sentence (start → middle → end)",
  "metaphors": ["2-3 concrete visual metaphors taken from the script, e.g. 'a jar slowly filling with coins'"],
  "mood": "music and sound mood in a few words"
}
```

## 2. Write `look/directions.json` with {{COUNT}}

```json
{
  "recommended": 1,
  "directions": [
    {
      "name": "2-4 word name of this look, e.g. 'Sunny paper village'",
      "style": "a ready style id from _ref/index.json",
      "why": "one sentence: why this look fits this script",
      "palette": { "bg": "#rrggbb", "bg2": "#rrggbb", "ink": "#rrggbb", "primary": "#rrggbb", "accent": "#rrggbb" },
      "fonts": { "heading": "exact family from fonts.json", "body": "exact family from fonts.json" },
      "motion": "gentle | crisp | playful | cinematic"
    }
  ]
}
```

Rules for directions:
- Colours come from the script's subject and mood (and the style's palette rules), not from a default. Each direction must look clearly different (different style or clearly different palette and type).
- `ink` must be readable on `bg` (contrast at least 7:1). `accent` is used sparingly.
- For an Urdu video (`plan.language` is "ur"), the heading font must be "Gulzar" or "Noto Nastaliq Urdu" and the body font "Noto Nastaliq Urdu".
- `recommended` is the number of the direction you think fits best.

## 3. Draw a style frame for each direction: `look/d1.html`, `look/d2.html`, `look/d3.html`

Each frame is ONE still image (1920×1080) showing how the video's opening will look in that direction:
the video title (from `plan.json`) plus a drawing of one of your visual metaphors, composed following that style's rules. It must look like a finished frame from a beautiful animated video, not a slide.

Technical rules for the frame files:
- A complete HTML document. `<body style="margin:0">` containing one `<div>` of exactly 1920×1080 px with `overflow:hidden`.
- Load fonts only with `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=QUERY&family=QUERY&display=block">`, using the `query` values from fonts.json with spaces replaced by `+`.
- Draw everything with HTML/CSS and inline `<svg>`. No images, no external files except the font link, no JavaScript.
- Use only the direction's palette colours (you may use transparency and white/black at low opacity for shadows).
- Keep text within the frame with at least 100 px margin. Title at most 2 lines. For Urdu use `dir="rtl"`.

## Banned (never in the brief, the directions or the frames)
Neon or glow effects, cyberpunk, synthwave, glitch or scanlines, terminals, command prompts, code windows, monospace "hacker" fonts, sci-fi HUDs, neural-network or brain-circuit imagery, matrix rain, ASCII art, and gamified wording (levels, XP, quests, power-ups, unlock, achievements).

Write only the files above (inside `look/`). Do not change plan.json. When finished, reply with just: DONE
