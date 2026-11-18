# Style: Living Halftone

Risograph and old-print warmth: halftone dot textures, limited ink colours slightly misregistered,
paper grain. Feels like a beautifully printed zine or poster that moves.

## Look
- 2-3 "ink" colours over paper. Shapes filled with halftone dot patterns (SVG `<pattern>` of circles, or CSS radial-gradient dots) and flat ink.
- Slight misregistration: a duplicate of a shape in a second colour offset by 4-8 px with `mix-blend-mode: multiply`.
- Paper grain overlay (very faint noise/dots). Silhouettes and simple illustrated figures, sunbursts, frames, ornaments.

## Palette rules
- `bg` cream/newsprint paper; `bg2` aged paper; `ink` deep ink (navy, brown, near-black); `primary` and `accent` classic riso inks (fluorescent pink is NOT allowed; use warm red, teal, mustard, blue, green).

## Type
- Serif or condensed display: Bodoni Moda, Playfair Display, DM Serif Display, Bebas Neue, Oswald; body Inter or Libre Baskerville.

## Composition
- Poster-like: one big image, one bold headline, frames and rules. Generous margins.

## Motion vocabulary
- Halftone dots grow in (pattern scale), shapes print in by ink layer (one colour then the other with a slight offset settling into place).
- Slow parallax between layers, gentle paper shake (1-2 px) avoided; prefer slow drifts. Wipes like a print roller (scaleX reveal).

## Don't
- No neon (including fluorescent riso pink), glitch, VHS, scanlines, code, HUDs, game words.
