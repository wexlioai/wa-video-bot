# Task: plan a long text as a video series

The person sent a long text (a book or long document). It has been split into numbered sections.
`sections.json` lists every section with its `heading`, `words`, `minutes` (narration length) and a `preview` (its first words).

Write `outline.json`:
```json
{
  "title": "series title (the book's title if you can tell)",
  "summary": "one or two sentences: what the text is about",
  "episodes": [ { "n": 1, "title": "short episode title", "sections": [1, 2] } ]
}
```
Rules:
- Use every section exactly once, in the original order. Only group neighbouring sections.
- Each episode should be about 5-12 minutes (sum of its sections' `minutes`); a section longer than 12 minutes is an episode on its own.
- Follow the text's real structure (chapters) when you can see it. Titles are short and in the text's language.
- Skip nothing; front matter (contents, copyright page) can be grouped into the first episode.

Write only outline.json. When finished, reply with just: DONE
