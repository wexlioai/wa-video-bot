# Task: turn a video script into a scene plan

You are in a job folder containing:
- `{{SOURCE}}`: the original script file (PDF, DOCX or TXT) the user sent.
- `script.txt`: text extracted from it. Urdu PDFs often extract badly (reversed or broken letters, missing spaces). If `script.txt` is empty, garbled or looks incomplete, Read `{{SOURCE}}` directly (you can read PDF pages) and work from that.

Write a single file `plan.json` that follows this schema:

{{SCHEMA}}

Rules:
1. **Narration is the user's own words.** Copy the script verbatim. Only remove what should not be spoken: headings like "Scene 1", "Intro", "Outro", speaker labels, bracketed stage directions such as [music] or (show map), page numbers, and visual notes. Fix obvious typos or extraction damage. Do not translate, summarize, rewrite or add sentences.
2. If the script is in Roman Urdu (Urdu written in English letters), write the narration in Urdu script with the same words, and set language "ur".
3. Split into scenes at natural thought boundaries: one idea per scene, 1-4 sentences, about 120-350 characters each. Never split mid-sentence.
4. Choose the visual type that fits each scene's content (see the table). Vary the types and don't use the same type more than 3 times in a row. The first scene is `title`.
5. Pick theme colors that suit the topic.
6. Write title, description and tags in the script's language. Tags may also include English keywords.

Write only `plan.json`. Do not create any other file. When finished, reply with just: DONE
