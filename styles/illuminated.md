# Style: Illuminated Manuscript

The beauty of an illuminated manuscript: gold-leaf borders, lapis and ink, margin ornaments and calm page
turns. For commentary on the Qur'an and hadith, ethics, spiritual and devotional texts.

## Look
- A manuscript page fills the frame: cream page, wide margins, a frame of gold and lapis bands with
  geometric or floral (arabesque) ornament drawn with SVG paths, corner medallions.
- Text block in the centre with a decorated heading panel (cartouche) for titles.
- Marginal medallions mark key ideas (a small gold rosette with a number or term).
- Gold is drawn as a warm gradient (#C9A24B → #8C6A2F) with a faint sheen sweep.

## Palette rules
- `bg` cream page, `bg2` deep lapis (#1E3A6E range) or deep green for outer areas, `ink` near-black brown,
  `primary` lapis or green, `accent` gold. Small touches of vermilion are allowed for ornament dots.

## Type
- Cormorant Garamond, Lora or Playfair Display; Arabic only from the text in Amiri or Scheherazade New.

## Motion
- Ornaments draw themselves (stroke-dashoffset), gold fills in after outlines; a light sheen passes across
  gold once.
- Page turn between ideas (a rotateY of the page group with perspective, 1.2 s) or a fade through the margin.
- Medallions bloom (scale 0.6 → 1 with rotation 30° → 0). Slow push-in on the page.
