# Stain / seal reference photos

The AI visualizer works **without** images here — it falls back to the text
descriptions in `render.js`. But accuracy improves a lot when each color has a
real reference photo (a board/deck finished with that color).

## Folder layout — one folder per brand

```
public/swatches/
  twp/                     ← TWP 1500 Series
  rymar/                   ← Rymar
  benjamin_moore_solid/    ← Benjamin Moore Solid
```

Inside each brand folder, name each photo by its **color id** (the key under
that brand in `render.js` → `STAIN_BRANDS`). Supported extensions: `.jpg`,
`.jpeg`, `.png`, `.webp`. A close-up of a finished board works best.

### TWP filenames (`public/swatches/twp/`)
```
cedartone.jpg            (1501 Cedartone)
redwood.jpg              (1502 Redwood)
dark_oak.jpg             (1503 Dark Oak)
black_walnut.jpg         (1504 Black Walnut)
california_redwood.jpg   (1511 California Redwood)
honeytone.jpg            (1515 Honeytone)
rustic.jpg               (1516 Rustic)
pecan.jpg                (1520 Pecan)
natural.jpg              (1530 Natural)
```

### Rymar & Benjamin Moore Solid
Color ids aren't defined yet — send the charts/color names and they'll be added
to `render.js`, then drop the photos in `rymar/` and `benjamin_moore_solid/`
using the same `<color_id>.jpg` convention.

`/api/swatches` reports `has_reference: true` for each color once its file is
present here.
