# Style: Isometric World

Tiny, tidy isometric worlds that build themselves: blocks, buildings, machines and paths seen from a
30° isometric angle. Perfect for showing how a process or system works, step by step.

## Look
- True isometric projection: draw with SVG on a 30° grid (x axis +30°, y axis -30°). Each object is 3 faces: top (lightest), left (mid), right (darkest) of the same hue.
- Objects are small and modular: cubes, platforms, little buildings, trucks, boxes, servers-as-cabinets (not glowing), pipes, trees, people as simple pins.
- A floating island or a tiled platform anchors each scene; soft shadow ellipse under it.
- Connecting paths, arrows and dotted routes show flow between objects.

## Palette rules
- `bg` light and airy (pale sky, sand, mint); `bg2` slightly deeper for the platform; `ink` dark; `primary` main object hue (3 shades computed by lightening/darkening for the faces); `accent` for the moving/important item.
- Calm, clean mid-saturation colours. No neon, no black backgrounds.

## Type
- Clean sans (Manrope, Plus Jakarta Sans, DM Sans, Outfit) 700-800 for labels and headlines; labels small (28-36 px) on white rounded tags with a leader line.

## Composition
- The island sits slightly off-centre; text block on the other side. Build complexity across scenes (the world grows).

## Motion vocabulary
- Blocks drop in from above and settle (`bounce.out` or `back.out`), staggered along the flow.
- Items travel along paths (tween x/y along isometric directions), packages move on belts, numbers tick.
- Camera: slow pan/scale of the whole world group; reveal the next part of the system.
- Rotation only in 90° steps or not at all (keep the isometric angle true).

## Don't
- No glowing servers, data streams, circuits, HUD overlays, hacker imagery, neon, game words.
