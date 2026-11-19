# Style: Court Archive

A dignified archive of judgments brought to life: parchment documents on a scholar's desk, ruled lines,
wax seals, stamps and ink. Built for court cases, judgments, fiqh rulings and legal principles.

## Look
- Base: parchment (`bg`) with a subtle paper grain and soft vignette; documents are lighter paper cards
  with a thin gold double rule border and a soft shadow (`0 24px 60px rgba(0,0,0,.18)`).
- Case card: kicker in letter-spaced small caps ("CASE 1 · OF 120"), large serif title, an italic line with
  court, place and date (AH / CE), a thin green rule, a wax seal (red radial gradient circle with an inner
  ring and a short label).
- Girih (8-point star) pattern bands in gold at 30-50 % opacity as borders or backgrounds of section openers.
- Judgment document: numbered clauses, big gold numeral, the key words underlined with a gold marker sweep,
  faint ruled lines below, a red circular "HELD" stamp (rotated about -12°).
- Court docket for issues: each question as a numbered line item with a small gold square bullet.
- Sources shelf: book spines standing on a shelf (colored leather tones with gold title bands) for classical
  sources; reference cards ("Qur'an 49:13") as small index cards pinned on the right.
- For facts with geography, use the map vocabulary of the Historical Map Documentary style inside a
  parchment frame.

## Palette rules
- `bg` parchment (#F3E8D0-#EEDFC0 range), `bg2` deeper parchment or a desk tone, `ink` dark brown-black,
  `primary` deep green (or a Part accent: crimson, lapis, ochre, slate), `accent` gold (#B08A3E range); seal
  red (#A8322B range) only for seals and stamps (use it as a literal colour).
- Opening and holding scenes may switch to a deep green or ink background with parchment documents on top.

## Type
- Headlines: Lora, Cormorant Garamond, Playfair Display or Libre Baskerville (600-700).
- Labels, kickers: Inter 600, uppercase, letter-spacing 8-12 px.
- Arabic (only from the text): Amiri or Noto Naskh Arabic.

## Motion
- Documents slide onto the desk from below with a slight rotation settling to 0; paper cards stack.
- Rules and borders draw (scaleX / stroke-dashoffset); text rises behind masks line by line.
- Seal: scale 1.4 → 1 with a short ease-out and a tiny settle; HELD stamp: scale 1.6 → 1, rotation -20° → -12°,
  opacity 0 → 1 in 0.25 s (the one punchy moment).
- Slow camera: the whole desk layer drifts 2-4 % or pans between documents.
- Underline sweeps under key words exactly when they are spoken.
