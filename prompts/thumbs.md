# Task: design 3 YouTube thumbnails

Design three thumbnails for this video. They must stop the scroll at a small size on a phone.

Read: `plan.json` (title, narration), `look.json` (palette, fonts, style, brief), `_ref/{{STYLE_FILE}}` (style rules), `_ref/fonts.json` (exact Google Fonts queries).

Write `thumbs/t1.html`, `thumbs/t2.html`, `thumbs/t3.html`. Each is a complete HTML document with one 1280×720 px `<div>` (`overflow:hidden`, `<body style="margin:0">`).
- A hook of at most 5 big words (not the full title), in the script's language. Huge, bold, very high contrast; readable at 160 px wide.
- One strong visual from the video's metaphors, drawn with HTML/CSS/inline SVG in the video's style and palette. Simple composition: one subject, one text block, lots of contrast.
- Make the three clearly different (different hook, layout or subject).
- Fonts only via `<link href="https://fonts.googleapis.com/css2?family=QUERY&display=block">` with queries from fonts.json. No images, no JavaScript, no external files.
- Keep the bottom-right corner (220×80 px) free: YouTube puts the duration there.
- Nothing from the banned list: neon, glow, cyberpunk, glitch, terminals, code, HUDs, brain-circuit imagery, game words. No clickbait lies.

Write only those files. When finished, reply with just: DONE
