```jsonc
{
  "language": "ur",                 // "ur" or "en": the language the narration is spoken in
  "title": "YouTube title, max 90 chars, in the script's language",
  "description": "2-4 short paragraphs for YouTube, then 3-5 hashtags",
  "tags": ["8 to 15 tags"],
  "kind": "case",                   // what the text is: case | fiqh | history | concept | biography | general
  "theme": {                        // all #rrggbb. Dark background, high-contrast text.
    "bg": "#0b1020", "bg2": "#1c2b52", "primary": "#4f8cff", "accent": "#ffd166", "text": "#ffffff"
  },
  "scenes": [
    {
      "id": "s01",                  // unique, keep ids stable when editing
      "narration": "Exact words to be spoken for this scene.",
      "section": "facts",           // the part of the structure this scene belongs to (see the plan rules)
      "visual": { "type": "title", "heading": "Short headline", "subheading": "optional" }
    }
  ]
}
```

Visual types (all on-screen text in the narration's language, short, headline style, never the full narration):

| type        | fields                                                                 | use for |
|-------------|------------------------------------------------------------------------|---------|
| `title`     | `heading`, `subheading?`                                               | first scene, section starts |
| `statement` | `text` (max ~12 words), `highlight?` (word(s) from text to color)      | one key idea |
| `bullets`   | `heading?`, `items` (1-6 strings, max ~7 words each)                   | lists, steps, reasons |
| `bignumber` | `value` (string like "73%", "2026", "Rs 500"), `label`                 | one central number or year |
| `quote`     | `text`, `author?`                                                      | quotations, sayings |
| `compare`   | `left: {title, items[]}`, `right: {title, items[]}` (items max 4 each) | A vs B, before/after, pros/cons |
| `bars`      | `heading?`, `bars: [{label, value:number}]` (2-6), `unit?` ("%")       | several comparable numbers |
