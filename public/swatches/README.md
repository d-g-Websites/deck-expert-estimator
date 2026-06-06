# Stain / seal swatch reference images

The AI visualizer works **without** images here — it uses the text descriptions
in `render.js` (`SWATCHES`). But accuracy improves a lot if you drop a real
reference photo for each finish in this folder.

Add files named by swatch id, e.g.:

```
cedar.jpg
redwood.jpg
mahogany.jpg
driftwood_gray.jpg
solid_gray.jpg
...
```

Supported extensions: `.jpg`, `.jpeg`, `.png`, `.webp`. Each should be a clear
photo of a deck/board finished with that stain — close-up of the wood works best.
The current swatch ids are defined in `render.js`.
