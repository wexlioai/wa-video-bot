# Style: Paper Cutout Storybook

A handmade world of layered, cut paper. Warm, tactile and calm, like a picture book brought to life: shapes
sit on top of each other with soft shadows, and props pop up into place as the story is told.

## Look
- Every shape is a flat paper piece: solid fill, a slightly irregular (hand-cut) edge, and a soft drop shadow
  under it: `filter: drop-shadow(0 6px 0 rgba(0,0,0,.08)) drop-shadow(0 14px 18px rgba(0,0,0,.12))`.
- Build depth with 3-5 layers: background sky/wall, mid hills or shelves, foreground props, text card on top.
- Hand-cut edges: SVG paths with gentle wobble (quadratic curves, no perfect circles for big shapes). Torn
  paper strips for headlines or banners (a zig-zag or wavy edge on one side).
- Subtle paper texture: a very faint dot or fibre pattern over large areas (opacity ≤ 0.05).
- Props are simple and charming: houses, trees, clouds, sun, coins, books, hearts, plants, figures with round
  heads. Faces: two dots at most.

## Palette rules
- 5 roles: `bg` (paper cream, warm off-white or a soft pastel), `bg2` (second paper tone, slightly darker),
  `ink` (deep brown, navy or charcoal; contrast ≥ 7 on bg), `primary` (the main paper colour of the props),
  `accent` (one warm highlight: tomato, marigold, coral, berry).
- Colours look like real coloured paper: slightly muted, never neon, never pure black.
- Derive from the topic: childhood/family → peach, butter, sky; nature/habits → sage, moss, sun yellow;
  money/savings → teal, mustard; faith/values → deep green, ivory, gold.

## Type
- Heading: a rounded or soft display face (Baloo 2, Fredoka, Fraunces, Nunito 800). Text often sits on a
  paper card or a torn strip.
- Body: Nunito, Quicksand or Poppins 500-600. Hand-written accents (Caveat, Kalam) only for small notes.
- Urdu: Gulzar or Noto Nastaliq Urdu on a paper card.

## Composition
- Storybook framing: a little stage. Ground strip at the bottom third, sky above, props placed like a diorama.
- Text lives on a paper card (`bg` or white, rounded 18-28 px, shadow) slightly rotated (-2° to 2°).
- Keep it uncluttered: 1 hero prop + 2-4 small supporting ones.

## Motion vocabulary
- Pop-up: props scale from 0 at their base (`transformOrigin: '50% 100%'`) with `back.out(2)`, as if folding
  up from the page.
- Slide in from behind a layer (masked by the layer above), like a pull-tab book.
- Gentle sway: trees, flags, clouds rotate ±2-3° or drift 10-20 px with `sine.inOut` while holding.
- Paper flip or card turn (rotationY 90° → 0°) for the next idea; page-turn wipes between scenes.
- Staggers 0.1-0.2 s; nothing fast or snappy. Overall pace calm.

## Do
- Tell the idea as a tiny scene (saving money → a jar filling with paper coins).
- Use layers moving at slightly different speeds for depth (parallax 10-40 px).

## Don't
- No photos, gradients across big areas, glossy 3D, hard flat-vector perfection.
- No neon, glow, glitch, terminals, code, HUDs, circuit/brain imagery, gamified words.
