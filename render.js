// ---------------------------------------------------------------------------
// AI Visualizer
// ---------------------------------------------------------------------------
// Applies a stain/seal finish to a customer's deck photo using OpenAI's
// image edit model (gpt-image-1). Same two-image technique as the CSC app:
// if a reference swatch photo exists in public/swatches/<id>.jpg it is passed
// as a style reference; otherwise we fall back to a descriptive text prompt.
// ---------------------------------------------------------------------------

import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWATCH_DIR = path.join(__dirname, "public", "swatches");

// Stain/seal options for the visualizer. `desc` describes the finished look so
// the model can produce it even before real reference photos are added.
// Drop a reference photo at public/swatches/<id>.jpg to improve accuracy.
export const SWATCHES = {
  natural_clear:  { name: "Natural / Clear",      desc: "a clear matte sealer that keeps the natural raw wood tone, with a soft non-glossy finish" },
  cedar:          { name: "Cedar",                desc: "a warm golden cedar-toned semi-transparent stain that lets the wood grain show through" },
  redwood:        { name: "Redwood",              desc: "a rich reddish redwood semi-transparent stain that lets the wood grain show through" },
  chestnut:       { name: "Chestnut",             desc: "a medium warm chestnut-brown semi-transparent stain" },
  mahogany:       { name: "Mahogany",             desc: "a deep reddish-brown mahogany semi-transparent stain" },
  walnut:         { name: "Walnut",               desc: "a dark coffee-brown walnut stain" },
  driftwood_gray: { name: "Driftwood Gray",       desc: "a weathered driftwood gray semi-transparent stain" },
  solid_gray:     { name: "Solid Gray",           desc: "a solid opaque slate-gray deck stain that fully hides the grain like paint" },
  solid_white:    { name: "Solid White",          desc: "a solid opaque warm-white deck stain that fully hides the grain like paint" },
};

let _openai = null;
function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Visualizer is not configured (missing OPENAI_API_KEY)");
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export function visualizerEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

async function preprocess(buffer, maxDim) {
  return sharp(buffer).rotate().resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
}

async function loadReference(swatchId) {
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const p = path.join(SWATCH_DIR, swatchId + ext);
    try {
      const buf = await fs.readFile(p);
      return buf;
    } catch (_) { /* try next */ }
  }
  return null;
}

function buildPrompt(swatch, hasReference) {
  const lines = [
    `You are doing precise photo editing — refinishing a wooden deck/porch surface with ${swatch.desc}.`,
  ];
  if (hasReference) {
    lines.push(
      `IMAGE 1 is the REFERENCE showing exactly how the "${swatch.name}" finish looks on wood. Study its color, tone, and how much grain shows.`,
      `IMAGE 2 is the TARGET: a customer's existing deck.`,
      `TASK: refinish ONLY the wood deck surfaces (floor boards, stairs, and railings) in Image 2 to match the "${swatch.name}" finish from Image 1.`,
    );
  } else {
    lines.push(
      `Refinish ONLY the wood deck surfaces (floor boards, stairs, and railings) in the photo with the "${swatch.name}" finish: ${swatch.desc}.`,
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

  const referenceBuf = await loadReference(swatchId);
  const prompt = buildPrompt(swatch, !!referenceBuf);

  let image;
  if (referenceBuf) {
    const refPng = await preprocess(referenceBuf, 1536);
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
