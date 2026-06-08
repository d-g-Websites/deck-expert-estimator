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
  clear: {
    name: "Clear & Sealers",
    colors: {
      natural_clear: { name: "Natural / Clear", hex: "#C8A56B", desc: "a clear matte sealer that keeps the natural raw wood tone, with a soft non-glossy finish" },
    },
  },
  ready_seal: {
    name: "Ready Seal",
    colors: {
      natural_cedar: { name: "Natural Cedar", hex: "#B07A43", desc: "a warm golden cedar-toned translucent oil stain that lets the wood grain show through" },
      light_oak:     { name: "Light Oak",     hex: "#C79A5B", desc: "a light honey-oak translucent oil stain, grain clearly visible" },
      pecan:         { name: "Pecan",         hex: "#8B5A2B", desc: "a medium warm pecan-brown translucent oil stain" },
      mahogany:      { name: "Mahogany",      hex: "#6E3B2A", desc: "a rich reddish-brown mahogany translucent oil stain" },
      dark_walnut:   { name: "Dark Walnut",   hex: "#4B2E1E", desc: "a deep dark-brown walnut translucent oil stain" },
    },
  },
  twp_1500: {
    name: "TWP 1500",
    colors: {
      cedartone: { name: "Cedartone", hex: "#A86B3C", desc: "a warm cedar-toned semi-transparent stain" },
      honeytone: { name: "Honeytone", hex: "#C68E4E", desc: "a golden honey-toned semi-transparent stain" },
      dark_oak:  { name: "Dark Oak",  hex: "#5C3A22", desc: "a deep dark-oak brown semi-transparent stain" },
      rustic:    { name: "Rustic",    hex: "#7A4326", desc: "a reddish rustic-brown semi-transparent stain" },
    },
  },
  armstrong_clark: {
    name: "Armstrong-Clark",
    colors: {
      cedar:         { name: "Cedar",         hex: "#A9703F", desc: "a warm cedar semi-transparent stain" },
      mahogany:      { name: "Mahogany",      hex: "#6B362A", desc: "a reddish-brown mahogany semi-transparent stain" },
      black_walnut:  { name: "Black Walnut",  hex: "#3E2A1E", desc: "a dark espresso black-walnut semi-transparent stain" },
      driftwood_gray:{ name: "Driftwood Gray",hex: "#8A857C", desc: "a weathered driftwood-gray semi-transparent stain" },
    },
  },
  solid_color: {
    name: "Solid Color",
    colors: {
      solid_cedar: { name: "Solid Cedar", hex: "#9C6038", desc: "a solid opaque cedar-brown deck stain that fully hides the grain like paint" },
      solid_gray:  { name: "Solid Gray",  hex: "#6E6E6E", desc: "a solid opaque slate-gray deck stain that fully hides the grain like paint" },
      solid_white: { name: "Solid White", hex: "#E8E2D8", desc: "a solid opaque warm-white deck stain that fully hides the grain like paint" },
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
