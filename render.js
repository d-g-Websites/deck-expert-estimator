// ---------------------------------------------------------------------------
// AI Visualizer
// ---------------------------------------------------------------------------
// Applies a stain/seal finish to a customer's deck photo using OpenAI's image
// edit model (gpt-image-1). Same two-image technique as the CSC app: if a
// reference photo exists for the chosen finish it is passed as a style
// reference; otherwise we fall back to a descriptive text prompt.
//
// FINISHES ARE ORGANIZED BY BRAND, with reference photos in per-brand folders:
//   public/swatches/<brand>/<color>.jpg
// e.g. public/swatches/twp/mahogany.jpg . Each swatch has a stable id of the
// form "<brand>__<color>" used in the API and stored on estimates.
//
// Replace/extend the brands and colors below with Deck Expert's real options.
// `hex` is just for the UI chip shown before a real photo exists; `desc` guides
// the AI. Brands with no colors yet are ignored until populated.

import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWATCH_DIR = path.join(__dirname, "public", "swatches");

export const STAIN_BRANDS = {
  twp: {
    name: "TWP 1500 Series",
    colors: {
      cedartone:          { name: "1501 Cedartone",         hex: "#B0762F", file: "1501-cedartone.png",          desc: "TWP 1501 Cedartone — a warm golden-brown cedar-toned semi-transparent oil stain, wood grain visible" },
      redwood:            { name: "1502 Redwood",           hex: "#9E4521", file: "1502-redwood.png",            desc: "TWP 1502 Redwood — a reddish-orange redwood-toned semi-transparent oil stain, grain visible" },
      dark_oak:           { name: "1503 Dark Oak",          hex: "#6F5638", file: "1053-darkoak.png",            desc: "TWP 1503 Dark Oak — a muted grayish-brown dark-oak semi-transparent oil stain" },
      black_walnut:       { name: "1504 Black Walnut",      hex: "#3D2B1B", file: "1504-blackwalnut.png",        desc: "TWP 1504 Black Walnut — a dark espresso-brown semi-transparent oil stain, grain still visible" },
      california_redwood: { name: "1511 California Redwood", hex: "#AE5E27", file: "1511-california-redwood.png", desc: "TWP 1511 California Redwood — a rich warm reddish-brown redwood semi-transparent oil stain" },
      honeytone:          { name: "1515 Honeytone",         hex: "#C68B3C", file: "1515-honeytone.png",          desc: "TWP 1515 Honeytone — a light golden honey-toned semi-transparent oil stain" },
      rustic:             { name: "1516 Rustic",            hex: "#8E4E2B", file: "1516-rustic.png",             desc: "TWP 1516 Rustic — a warm reddish rustic-brown semi-transparent oil stain" },
      pecan:              { name: "1520 Pecan",             hex: "#9E6A34", file: "1520-pecan.png",              desc: "TWP 1520 Pecan — a medium warm tan/pecan-brown semi-transparent oil stain" },
      natural:            { name: "1530 Natural",           hex: "#C08A40", file: "1530-natural.png",            desc: "TWP 1530 Natural — a light natural golden tone semi-transparent oil stain (similar to 1501 Cedartone)" },
    },
  },
  rymar: {
    name: "Rymar",
    colors: {
      honey_brown:         { name: "7600 Honey Brown",         hex: "#B97B3A", file: "Honey-Brown-7600.png",            desc: "Rymar 7600 Honey Brown — a warm honey-brown semi-transparent penetrating wood sealer" },
      clear:               { name: "7610 Clear",               hex: "#CBA063", file: "Clear-7610.png",                 desc: "Rymar 7610 Clear — a clear natural penetrating sealer that keeps the raw wood tone with little added color" },
      kodiak:              { name: "7615 Kodiak",              hex: "#5A3B24", file: "Kodiak-7615-e1710220139320.jpg", desc: "Rymar 7615 Kodiak — a deep dark-brown semi-transparent penetrating wood sealer" },
      nectar:              { name: "7620 Nectar",              hex: "#C68A3E", file: "Nectar-7620.png",                desc: "Rymar 7620 Nectar — a golden amber semi-transparent penetrating wood sealer" },
      natural_cedar_honey: { name: "7625 Natural Cedar Honey", hex: "#BC7E3C", file: "Natural-Cedar-Honey-7625.png",   desc: "Rymar 7625 Natural Cedar Honey — a warm cedar-honey semi-transparent penetrating wood sealer" },
      sienna:              { name: "7630 Sienna",             hex: "#9A4E2A", file: "Sienna-7630.png",                desc: "Rymar 7630 Sienna — a reddish sienna-brown semi-transparent penetrating wood sealer" },
      natural_cedartone:   { name: "7635 Natural Cedartone",   hex: "#B0762F", file: "Natural-Cedartone-7635.png",     desc: "Rymar 7635 Natural Cedartone — a warm golden cedar-tone semi-transparent penetrating wood sealer" },
      ember:               { name: "7640 Ember",              hex: "#8A4324", file: "Ember-7640.png",                 desc: "Rymar 7640 Ember — a warm reddish ember-brown semi-transparent penetrating wood sealer" },
      sequoia:             { name: "7645 Sequoia",            hex: "#7E3A24", file: "Sequioa-7645.png",               desc: "Rymar 7645 Sequoia — a deep reddish redwood-brown semi-transparent penetrating wood sealer" },
      shadow:              { name: "7650 Shadow",             hex: "#4E4034", file: "Shadow-7650.png",                desc: "Rymar 7650 Shadow — a dark grayish-brown semi-transparent penetrating wood sealer" },
      pine_cone:           { name: "7655 Pine Cone",          hex: "#7C5230", file: "Pine-Cone7655.png",              desc: "Rymar 7655 Pine Cone — a medium warm brown semi-transparent penetrating wood sealer" },
      hickory_bark:        { name: "7660 Hickory Bark",       hex: "#5C4126", file: "Hickory-Bark-7660.png",          desc: "Rymar 7660 Hickory Bark — a dark warm hickory-brown semi-transparent penetrating wood sealer" },
      teak:                { name: "5040 Teak",               hex: "#A97C45", file: "teak-5040.png",                  desc: "Rymar 5040 Teak — a warm golden teak-brown semi-transparent penetrating wood sealer" },
    },
  },
  // TODO: populate from the Benjamin Moore solid-stain chart.
  benjamin_moore_solid: {
    name: "Benjamin Moore Solid",
    colors: {},
  },
};

// Flatten brands -> { "<brand>__<color>": { id, brand_id, brand_name, color_id, name, hex, desc } }
export const SWATCHES = (() => {
  const out = {};
  for (const [brandId, brand] of Object.entries(STAIN_BRANDS)) {
    for (const [colorId, color] of Object.entries(brand.colors)) {
      const id = `${brandId}__${colorId}`;
      out[id] = { id, brand_id: brandId, brand_name: brand.name, color_id: colorId, name: color.name, hex: color.hex || null, file: color.file || null, desc: color.desc };
    }
  }
  return out;
})();

let _openai = null;
function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Visualizer is not configured (missing OPENAI_API_KEY)");
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export function visualizerEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

const REF_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

// Reference photos live at public/swatches/<brand>/<color>.<ext>
async function findReference(swatchId) {
  const s = SWATCHES[swatchId];
  if (!s) return null;
  // Prefer an explicit filename; otherwise scan <color_id>.<ext>.
  const candidates = [];
  if (s.file) candidates.push(`${s.brand_id}/${s.file}`);
  for (const ext of REF_EXTS) candidates.push(`${s.brand_id}/${s.color_id}${ext}`);
  for (const rel of candidates) {
    const p = path.join(SWATCH_DIR, rel);
    try { await fs.access(p); return { path: p, url: `/swatches/${rel}` }; } catch (_) { /* next */ }
  }
  return null;
}

// Grouped swatch catalog for the UI, including whether a reference photo exists.
// Brands with no colors yet are omitted.
export async function listSwatches() {
  const brands = {};
  for (const [brandId, brand] of Object.entries(STAIN_BRANDS)) {
    const colorIds = Object.keys(brand.colors);
    if (colorIds.length === 0) continue;
    const colors = {};
    for (const colorId of colorIds) {
      const id = `${brandId}__${colorId}`;
      const s = SWATCHES[id];
      const ref = await findReference(id);
      colors[id] = { id, name: s.name, hex: s.hex, reference_url: ref ? ref.url : `/swatches/${brandId}/${colorId}.jpg`, has_reference: !!ref };
    }
    brands[brandId] = { name: brand.name, colors };
  }
  return brands;
}

async function preprocess(buffer, maxDim) {
  return sharp(buffer).rotate().resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
}

function buildPrompt(swatch, hasReference) {
  const finishLabel = `${swatch.brand_name} ${swatch.name}`;
  const lines = [
    `You are doing precise, restrained photo editing — applying a wood stain (${swatch.desc}) to a deck. The goal is a believable real-estate "after" photo, NOT a glamour or HDR render.`,
  ];
  if (hasReference) {
    lines.push(
      `IMAGE 1 is a small REFERENCE swatch shown ONLY to indicate the general HUE of "${finishLabel}". The swatch is a heavy, full-strength coat on bright fresh wood under studio light — do NOT reproduce that intensity or darkness. Apply only a light fraction of that strength.`,
      `IMAGE 2 is the TARGET: the customer's actual deck. Apply the "${finishLabel}" color to it.`,
      `TASK: refinish ONLY the wood deck surfaces (floor boards, stairs, railings) in Image 2 to a realistic, slightly muted version of the "${finishLabel}" color.`,
    );
  } else {
    lines.push(
      `Refinish ONLY the wood deck surfaces (floor boards, stairs, railings) with a realistic, slightly muted "${finishLabel}" finish: ${swatch.desc}.`,
    );
  }
  lines.push(
    `CRITICAL — keep it natural and understated:`,
    `Do NOT brighten the image, raise exposure, add contrast, or oversaturate. Keep the EXACT original lighting, exposure, white balance, shadows, and time of day from Image 2.`,
    `Apply the stain as a TRANSLUCENT wash — a light tinted glaze at roughly 40% strength, NOT paint. The deck's existing wood grain, knots, and natural board-to-board light/dark variation MUST stay clearly visible through the tint. The boards must still read as real wood that was lightly tinted, never as a solid, uniformly recoated or painted surface.`,
    `Keep the deck close to its ORIGINAL brightness — only a gentle hue shift, not a full recolor. Do NOT darken the deck much; even the darker colors (Dark Oak, Black Walnut) must stay relatively light and translucent rather than deep, opaque, or near-black. When in doubt, err lighter, more subtle, and more transparent.`,
    `Use a natural matte / low-sheen finish — no glossy shine, no glow, no HDR look, no wet appearance.`,
    `Preserve everything else exactly as-is: same perspective, lighting, house, siding, furniture, plants, sky, and objects on the deck. Only the wood surface color/tone changes. The result should look like an ordinary phone photo of a freshly stained deck taken in the same conditions.`,
  );
  return lines.join(" ");
}

// Render a finish onto a deck photo. Returns base64 PNG.
export async function renderFinish(photoBuffer, swatchId) {
  const swatch = SWATCHES[swatchId];
  if (!swatch) throw new Error("Unknown swatch_id");

  const photoPng = await preprocess(photoBuffer, 2048);
  const photoFile = await toFile(photoPng, "deck.png", { type: "image/png" });

  const ref = await findReference(swatchId);
  const prompt = buildPrompt(swatch, !!ref);

  let image;
  if (ref) {
    const refPng = await preprocess(await fs.readFile(ref.path), 1536);
    const refFile = await toFile(refPng, "reference.png", { type: "image/png" });
    image = [refFile, photoFile];
  } else {
    image = photoFile;
  }

  const result = await client().images.edit({
    model: "gpt-image-1",
    image,
    prompt,
    size: "1024x1024",
  });
  if (!result.data || !result.data[0] || !result.data[0].b64_json) {
    throw new Error("OpenAI returned no image data");
  }
  return result.data[0].b64_json;
}
