import sharp from "sharp";
import fs from "fs/promises";

const DIR = "public/swatches/benjamin_moore_solid";
const SRC = "public/swatches/_source";

// Row-major cell maps. [name, code] per cell; null = empty cell.
const sheet1 = {
  file: `${SRC}/bm_solid_sheet1.jpg`, cols: 7, rows: 7,
  cells: [
    null,["Maritime White","OC-5"],["Sea Gull Gray","ES-72"],["Cougar Brown","2106-40"],["Santa Rosa","1189"],["Fox Run","1229"],["Arbor White","ES-01"],
    null,["Bennington Gray","HC-82"],["Briarwood","HC-175"],["Smoked Oyster","2109-40"],["Garrison Red","HC-66"],["Georgian Brick","HC-50"],["Richmond Bisque","HC-177"],
    null,["Beige Gray","ES-51"],["Rustic Taupe","999"],["Pinch of Spice","1449"],["Boston Brick","2092-30"],["Terra Mauve","105"],["Bradstreet Beige","HC-48"],
    null,["Alexandria Beige","HC-77"],["Fairview Taupe","HC-85"],["Beaujolais","1259"],["Sweet Rosy Brown","1302"],["California Rustic","ES-24"],["Potters Clay","1221"],
    null,["Cabot Trail","998"],["Dragon's Breath","1547"],["New Pilgrim Red","ES-21"],["Barn Red","ES-22"],["Rabbit Brown","2105-30"],["Natural Cedartone","ES-45"],
    ["Redwood","ES-20"],["Spanish Moss","ES-44"],["River Rock","2139-10"],["Vintage Wine","2116-20"],["Bison Brown","2113-30"],["Leather Saddle Brown","2100-20"],["Hidden Valley","1134"],
    ["Mahogany","ES-60"],["Cordovan Brown","ES-62"],["Black","HC-190"],["Dark Purple","2073-10"],["Oxford Brown","ES-67"],["Fresh Brew","1232"],["Abbey Brown","1225"],
  ],
};
const sheet2 = {
  file: `${SRC}/bm_solid_sheet2.jpg`, cols: 5, rows: 7,
  cells: [
    ["Dunmore Cream","HC-29"],["Dry Sage","2142-40"],["Silver Mist","1619"],["Cliffside Gray","HC-180"],["Platinum Gray","HC-179"],
    ["Chestertown Buff","HC-9"],["Creekside Green","2141-40"],["Celtic Blue","ES-31"],["Imperial Gray","1571"],["Chelsea Gray","HC-168"],
    ["Wilmington Tan","HC-34"],["Ferndale Green","ES-43"],["Normandy","2129-40"],["Georgetown Gray","ES-77"],["Amherst Gray","HC-167"],
    ["Avant Garde","272"],["Kennebunkport Green","HC-123"],["Hamilton Blue","HC-191"],["Stonehedge","ES-76"],null,
    ["Mystic Gold","HC-37"],["Rosepine","461"],["Spellbound","1659"],["Ashland Slate","1608"],null,
    ["Norwich Brown","HC-19"],["Cedar Mountains","706"],["Olympus Green","679"],["Westcott Navy","1624"],null,
    ["Mountain Moss","2142-30"],["Dakota Shadow","448"],["Salamander","2050-10"],["Blue Note","2129-30"],null,
  ],
};

function slug(name) {
  return name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function sampleHex(file, cols, rows, r, c) {
  const { width: W, height: H } = await sharp(file).metadata();
  const cw = W / cols, ch = H / rows;
  const left = Math.round(c * cw + cw * 0.40);
  const top = Math.round(r * ch + ch * 0.22);
  const w = Math.max(2, Math.round(cw * 0.18));
  const h = Math.max(2, Math.round(ch * 0.16));
  const buf = await sharp(file).extract({ left, top, width: w, height: h }).resize(1, 1).raw().toBuffer();
  return [buf[0], buf[1], buf[2]];
}

async function genSwatch(rgb, outPath) {
  await sharp({ create: { width: 600, height: 360, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toFile(outPath);
}

const out = {};
const rows = [];
for (const sheet of [sheet1, sheet2]) {
  for (let i = 0; i < sheet.cells.length; i++) {
    const cell = sheet.cells[i];
    if (!cell) continue;
    const [name, code] = cell;
    const r = Math.floor(i / sheet.cols), c = i % sheet.cols;
    const rgb = await sampleHex(sheet.file, sheet.cols, sheet.rows, r, c);
    const hex = "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");
    const id = slug(name);
    if (out[id]) throw new Error("Duplicate id: " + id);
    await genSwatch(rgb, `${DIR}/${id}.png`);
    out[id] = { name: `${name} ${code}`, hex, desc: `Benjamin Moore ${name} ${code} — a solid opaque deck stain in this color` };
    rows.push(`${(name + " " + code).padEnd(28)} ${hex}   -> ${id}.png`);
  }
}

await fs.writeFile("bm-colors.json", JSON.stringify(out, null, 2) + "\n");
console.log(rows.join("\n"));
console.log("\nTotal colors:", Object.keys(out).length);
