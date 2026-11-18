# Task: apply a change request to an existing video

The video is rendered entirely from `plan.json` in this folder (the original script is `{{SOURCE}}` / `script.txt` if you need it). Scenes are numbered from 1 in the order they appear (scene 1 = the first entry in `scenes`).

The user sent this request on WhatsApp. It may be in English, Urdu or Roman Urdu:

"""
{{REQUEST}}
"""

What you can change in `plan.json`:
- a scene's visual (type and on-screen text)
- theme colors
- title, description, tags
- a scene's narration, **only** if the user asks to change the spoken words (the voice is regenerated for that scene)
- splitting, merging, reordering or deleting scenes

Schema:

{{SCHEMA}}

Make the smallest edit that satisfies the request, using the Edit tool on `plan.json`. Don't touch anything else, and keep existing scene ids.

If the request needs something this template can't do (a logo, background music, real photos or video clips, a different font, changing speed or voice), change nothing and reply with one line starting with `CANNOT:` followed by the reason.

Otherwise reply with ONE short line, in the user's language, saying what you changed.
