# Stain / seal reference photos

The AI visualizer works **without** images here — it falls back to the text
descriptions in `render.js`. But accuracy improves a lot when each finish has a
real reference photo of a deck/board with that stain on it.

## Naming

Finishes are organized **by brand**, and each swatch has an id of the form
`<brand>__<color>` (double underscore). Drop a reference photo named by that id:

```
ready_seal__natural_cedar.jpg
ready_seal__mahogany.jpg
twp_1500__cedartone.jpg
armstrong_clark__driftwood_gray.jpg
solid_color__solid_gray.jpg
```

Supported extensions: `.jpg`, `.jpeg`, `.png`, `.webp`. A close-up of a finished
deck board works best. The current brand/color ids live in `render.js`
(`STAIN_BRANDS`) — the `/api/swatches` endpoint reports `has_reference: true`
once a matching file is present here.

## Brands / colors are placeholders

The brands and colors in `render.js` are placeholders. Replace them with the
actual brands and colors Deck Expert offers, then add the matching photos here.
