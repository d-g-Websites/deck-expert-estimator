// ---------------------------------------------------------------------------
// AI Visualizer
// ---------------------------------------------------------------------------
// Applies a stain/seal finish to a customer's deck photo using OpenAI's image
// edit model (gpt-image-1). Same two-image technique as the CSC app: if a
// reference photo exists for the chosen finish it is passed as a style
// reference; otherwise we fall back to a descriptive text prompt.
//
// FINISHES ARE ORGANIZED BY BRAND. Each swatch has a stable id of the form
// "<brand>__<color>" (e.g. "ready_seal__mahogany"). To add a reference photo,
// drop a file at public/swatches/<brand>__<color>.jpg (see public/swatches/README).
//
// The brands/colors below are PLACEHOLDERS — replace them with the exact brands
// and colors Deck Expert offers. `hex` is just for the UI swatch chip shown
// before a real reference photo is added; `desc` is what guides the AI.
// ---------------------------------------------------------------------------

import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWATCH_DIR = path.join(__dirname, "public", "swatches");

export const STAIN_BRANDS = {
  twp_1500: {
    name: "TWP 1500 Series",
    colors: {
      cedartone:          { name: "1501 Cedartone",         hex: "#B0762F", desc: "TWP 1501 Cedartone — a warm golden-brown cedar-toned semi-transparent oil stain, wood grain visible" },
      redwood:            { name: "1502 Redwood",           hex: "#9E4521", desc: "TWP 1502 Redwood — a reddish-orange redwood-toned semi-transparent oil stain, grain visible" },
      dark_oak:           { name: "1503 Dark Oak",          hex: "#6F5638", desc: "TWP 1503 Dark Oak — a muted grayish-brown dark-oak semi-transparent oil stain" },
      black_walnut:       { name: "1504 Black Walnut",      hex: "#3D2B1B", desc: "TWP 1504 Black Walnut — a dark espresso-brown semi-transparent oil stain, grain still visible" },
      california_redwood: { name: "1511 California Redwood", hex: "#AE5E27", desc: "TWP 1511 California Redwood — a rich warm reddish-brown redwood semi-transparent oil stain" },
      honeytone:          { name: "1515 Honeytone",         hex: "#C68B3C", desc: "TWP 1515 Honeytone — a light golden honey-toned semi-transparent oil stain" },
      rustic:             { name: "1516 Rustic",            hex: "#8E4E2B", desc: "TWP 1516 Rustic — a warm reddish rustic-brown semi-transparent oil stain" },
      pecan:              { name: "1520 Pecan",             hex: "#9E6A34", desc: "TWP 1520 Pecan — a medium warm tan/pecan-brown semi-transparent oil stain" },
      natural:            { name: "1530 Natural",           hex: "#C08A40", desc: "TWP 1530 Natural — a light natural golden tone semi-transparent oil stain (similar to 1501 Cedartone)" },
    },
  },
};

// Flatten brands -> { "<brand>__<color>": { id, brand_id, brand_name, color_id, name, hex, desc } }
export const SWATCHES = (() => {
  const out = {};
  for (const [brandId, brand] of Object.entries(STAIN_BRANDS)) {
    for (const [colorId, color] of Object.entries(brand.colors)) {
      const id = `${brandId}__${colorId}`;
      out[id] = { id, brand_id: brandId, brand_name: brand.name, color_id: colorId, name: color.name, hex: color.hex || null, desc: color.desc };
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

async function findReferencePath(swatchId) {
  for (const ext of REF_EXTS) {
    const p = path.join(SWATCH_DIR, swatchId + ext);
    try { await fs.access(p); return p; } catch (_) { /* next */ }
  }
  return null;
}

// Grouped swatch catalog for the UI, including whether a reference photo exists.
export async function listSwatches() {
  const brands = {};
  for (const [brandId, brand] of Object.entries(STAIN_BRANDS)) {
    const colors = {};
    for (const colorId of Object.keys(brand.colors)) {
      const id = `${brandId}__${colorId}`;
      const s = SWATCHES[id];
      const refPath = await findReferencePath(id);
      colors[id] = { id, name: s.name, hex: s.hex, reference_url: `/swatches/${id}.jpg`, has_reference: !!refPath };
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
    `You are doing precise photo editing — refinishing a wooden deck/porch surface with ${swatch.desc}.`,
  ];
  if (hasReference) {
    lines.push(
      `IMAGE 1 is the REFERENCE showing exactly how the "${finishLabel}" finish looks on wood. Study its color, tone, and how much grain shows through.`,
      `IMAGE 2 is the TARGET: a customer's existing deck.`,
      `TASK: refinish ONLY the wood deck surfaces (floor boards, stairs, and railings) in Image 2 to match the "${finishLabel}" finish from Image 1.`,
    );
  } else {
    lines.push(
      `Refinish ONLY the wood deck surfaces (floor boards, stairs, and railings) in the photo with the "${finishLabel}" finish: ${swatch.desc}.`,
    );
  }
  lines.push(
    `Keep the wood plank texture and board seams realistic. Preserve everything else exactly as-is: same perspective, lighting, house, siding, furniture, plants, sky, and any objects on the deck. Only the wood finish color/tone changes.`,
    `Output a photorealistic result that looks like a freshly stained or sealed deck.`,
  );
  return lines.join(" ");
}

// Render a finish onto a deck photo. Returns base64 PNG.
export async function renderFinish(photoBuffer, swatchId) {
  const swatch = SWATCHES[swatchId];
  if (!swatch) throw new Error("Unknown swatch_id");

  const photoPng = await preprocess(photoBuffer, 2048);
  const photoFile = await toFile(photoPng, "deck.png", { type: "image/png" });

  const refPath = await findReferencePath(swatchId);
  const prompt = buildPrompt(swatch, !!refPath);

  let image;
  if (refPath) {
    const refPng = await preprocess(await fs.readFile(refPath), 1536);
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
