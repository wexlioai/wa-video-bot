# Style: Flat Explainer

Clean, confident vector illustration that explains. Think a well-made product explainer or a public-health
animation: simple shapes, friendly people and objects, lots of breathing room, everything moving with purpose.

## Look
- Flat fills, no gradients except a very soft background wash. No textures, no glow, no outlines thicker than 6 px.
- Objects are built from simple geometry: rounded rectangles (radius 16-40 px), circles, pill shapes, soft triangles.
- People: simple figures (circle head, rounded-rect body, pill limbs), no facial detail beyond two dots and a small smile or none at all. Skin tones vary naturally.
- Icons and objects are large and few: one hero object per scene, at most 2-3 supporting ones.
- A ground line, a soft blob or a rounded card often anchors the object.
- Generous margins: nothing important within 120 px of the edge (Shorts: 90 px sides, keep the bottom 560 px for captions).

## Palette rules
- 5 roles: `bg` (light, calm, never pure white), `bg2` (slightly deeper or warmer tint of bg), `ink` (dark text, contrast ≥ 7 on bg), `primary` (the main object colour), `accent` (one warm or bright pop used sparingly, for the key number/word).
- Derive the hues from the topic: finance → deep green/teal + gold; health → soft teal + coral; food → tomato, olive, cream; travel → sky blue + sand; home/family → terracotta + sage.
- Mid-saturation, never neon. Accent may be brighter but must not be fluorescent.

## Type
- Heading: a friendly geometric or modern sans (Poppins, Outfit, Plus Jakarta Sans, Manrope) weight 700-800.
- Body: Inter, DM Sans or the same family at 500-600.
- Headlines short, sentence case, 1-2 lines. Numbers big and in `accent` or `primary`.

## Composition
- One idea per frame. Hero object on one side (left or right third), headline on the other; alternate sides between scenes.
- Use cards (white or `bg2` rounded rectangles with a soft shadow `0 18px 40px rgba(0,0,0,.08)`) to group text.
- Charts are simple: 3-6 thick rounded bars, a single line, or a donut with one highlighted slice.

## Motion vocabulary
- Entrances: scale from 0 with `back.out(1.6)`, slide 60-120 px with `power3.out`, line drawing with stroke-dashoffset.
- Morphs: one shape becomes the next idea (circle → coin → clock) using scale/borderRadius/colour tweens.
- Staggers of 0.08-0.15 s for groups. Keep holds: after things arrive, let them breathe with a slow 3-5 % drift or gentle float (y ±8 px, sine.inOut).
- Transitions between ideas: wipe with a big shape in `primary` or `bg2`, or the hero object moves and becomes the next scene's anchor.
- Every element that arrives should arrive when the voice mentions it.

## Do
- Make the visual metaphor literal and simple (a "safety net" is a drawn net under a figure).
- Use arrows, checkmarks, counters and simple charts to explain.

## Don't
- No stock-photo look, no 3D, no isometric (that is a different style).
- No neon, glow, glitch, scanlines, terminal or code windows, HUDs, circuit or brain-network imagery, game words (levels, XP, quests, unlock).
- No walls of text: at most 12 words on screen besides captions.
