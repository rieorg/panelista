# Pany

Panelista's mascot: a teacher who is always on the panel. Sassy, warm, never mean.

**Always attach `pany-reference.png`** (this folder) to every Pany generation, in
/img:gemini or AI Studio. Add `pany-sheet-v1.png` too when the pose needs the
original style. One job at a time; the image quota is shared.

## Base prompt

Paste this, then add the pose line at the end.

```
Use the attached model sheet as the exact character reference. Draw Pany, the
same character: a young Filipina chinita teacher, flat vector illustration with
clean dark outlines and flat fills, no gradients. Black hair in a high bun with
a yellow pencil (pink eraser) pushed through it, pointing up and to the right;
a short ponytail tail falls from the bun. Black angular cat-eye glasses whose
outer tips sweep up about 20 degrees. Green blazer (#42684E) with notched
lapels over a cream blouse (#FEE5C8), a cream panel ID card on a grey lanyard,
black trousers, black flats, small gold stud earrings. Soft oval face, small
chin, warm skin (#E3B18D), warm confident smile. Sassy but family friendly.
Plain off-white background (#FAF9F4). No text, no labels, no watermark.
Pose: <one line, e.g. "waving hello with her right hand, three-quarter view">
```

For a sheet of several poses, ask for 16:9 at 2K with the poses in one row,
evenly spaced, then crop each one.

## Never changes

- High bun with a yellow pencil through it, eraser pink, pointing up and right
- Angular cat-eye glasses, black frame, outer tips up about 20 degrees
- Green blazer over a cream blouse, notched lapels, sleeves to the wrist
- Panel ID on a grey lanyard: cream card with a tan photo square
- Face shape: soft oval, small chin, chinita eyes
- Ponytail tail from the bun, gold stud earrings, black flats

## Palette

| Part | Hex |
|---|---|
| Hair, trousers, shoes | `#202127` |
| Glasses frame, line art | `#282023` |
| Blazer (art) | `#42684E` |
| Blazer in app UI, logo tile | `#176B55` |
| Skin | `#E3B18D` |
| Skin shadow, lips | `#C47C60` |
| Blouse | `#FEE5C8` |
| Pencil, earrings | `#EBA832` |
| Pencil eraser | `#D9707F` |
| Background | `#FAF9F4` |

Sampled from `pany-turnaround.png`. The art blazer is softer than the brand
green; the logo tile is recolored to `#176B55`.

## Proportions

- 4.7 heads tall, crown to floor; the bun adds about a third of a head
- Crown to chin is 21% of height; shoulders sit just under the chin line
- Blazer hem at the hips, 55% down; hips to floor is 45%
- Shoulders about 1.6 head widths across

## Do

- Flat vector, clean outlines, plain light background for cutouts
- Sassy, warm, family friendly
- Check the result against "Never changes" before using it

## Don't

- No round, square or rimless glasses
- No loose hair, no second bun, no missing pencil
- No other blazer color, no logo or text on her clothes
- No text, labels or watermarks in the art (crop them if the model adds them)
- No mean, mocking or adult poses
- Not modeled on any existing character; only the angular cat-eye frame shape is a borrowed idea

## Files

- `pany-reference.png`: model sheet (turnaround, palette, rules, expressions)
- `pany-turnaround.png`: front, three-quarter, side, back on proportion lines
- `pany-sheet-v1.png`, `pany-poses-v2.png`: source pose sheets
- `pose-*.jpg`: cropped poses (originals); `pose-*.png`: the same with the background keyed out to alpha (use these in the app)
- `pany-avatar-round.png`, `pany-avatar-tip.png`, `pany-avatar-oops.png`: 256 px avatars on a soft green #E3EFE9 circle fill; `pany-avatar.jpg` is the original
- `pany-mark.svg`, `pany-mark-*.png`: logo mark
