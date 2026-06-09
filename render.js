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
  // TODO: populate from the Rymar chart (color name + hex + desc per swatch).
  rymar: {
    name: "Rymar",
    colors: {},
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
      `IMAGE 1 is a REFERENCE swatch for the "${finishLabel}" finish. Use it ONLY to judge the hue / color family and how much wood grain shows through. IMPORTANT: this swatch is photographed on fresh wood under bright studio lighting, so it looks much more vivid and saturated than a real installed deck — render the color SIGNIFICANTLY more muted, desaturated and natural than the swatch.`,
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
    `The stain is a thin SEMI-TRANSPARENT finish, not paint: let the natural wood grain and board-to-board tone variation show through, and dial the color intensity well down so it reads like a real applied stain that has soaked into the wood (roughly 30–35% less saturated and a bit lighter than the swatch). When in doubt, err on the side of subtle and lighter rather than rich and deep.`,
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
