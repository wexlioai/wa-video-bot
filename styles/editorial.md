# Style: Editorial Magazine

The confidence of a great magazine or newspaper feature: big serif headlines, a strong grid, rules and
columns, numbers set like infographics, and shapes cut like photo frames. Smart, serious, never dull.

## Look
- A visible grid: 12 columns, thin rules (2-3 px in `ink` at 20-60 % opacity), column dividers, a folio line
  ("Issue", date or section name in small caps at the top).
- Big headline type is the hero. Pull quotes with large quotation marks. Drop caps for openers.
- Image areas are cut shapes (rectangles, circles, arches) filled with flat colour, a duotone halftone pattern,
  or a simple illustrated silhouette — never stock photos.
- Infographic numbers: huge numerals with small labels, thin underline rules, percentage bars as solid blocks.
- Paper-white or newsprint backgrounds; one strong colour block per frame.

## Palette rules
- 5 roles: `bg` (newsprint white, cream or a pale tint), `bg2` (a slightly deeper print tone or a
  colour-block shade), `ink` (near-black, contrast ≥ 10 on bg), `primary` (the feature colour: oxblood,
  deep blue, forest, ochre), `accent` (a second print colour used for highlights and numbers).
- Print-like colours: confident, slightly muted, two inks plus black. No neon, no pastels-only palettes.
- Derive from the subject: economy → navy + mustard; politics/news → oxblood + charcoal; business → deep
  green + copper; culture → plum + saffron.

## Type
- Heading: Playfair Display, DM Serif Display, Fraunces, Bodoni Moda (700-900) or a condensed sans
  (Bebas Neue, Oswald, Archivo Black) for a news feel.
- Body and labels: Inter, Manrope or Archivo 500-700; small caps with letter-spacing 2-4 px for kickers.
- Urdu: Gulzar for headlines, Noto Nastaliq Urdu for text.

## Composition
- Asymmetric layouts on the grid: headline over 7-8 columns, a supporting block in the remaining columns.
- Kicker (small caps section name) above the headline, a thin rule between kicker and headline.
- Each scene is like a spread: one headline or number, one supporting element, one rule or frame.

## Motion vocabulary
- Rules draw across (scaleX from 0, `power3.inOut`), then type rises behind a mask line by line.
- Columns slide in like pages; frames open as clip-path reveals (inset or circle).
- Numbers count up; bars fill as solid blocks; highlight marker sweeps under key words.
- Camera-like moves across a large "page": pan 100-300 px and slow scale 1 → 1.05 over the scene.
- Crisp easing (`power3`, `expo.out`), short staggers (0.05-0.1 s), clean cuts or page-slide transitions.

## Do
- Treat each statement like a headline someone would print.
- Use real typographic hierarchy: kicker, headline, deck, body, caption.

## Don't
- No cartoon characters, no rounded bubbly fonts, no glossy 3D.
- No neon, glow, glitch, terminals, code, HUDs, circuit/brain imagery, gamified words.
