#!/usr/bin/env node
// @comic-threads/avb-extract
// Parses Microsoft Comic Chat .avb character files, decodes every pose bitmap
// to a PNG with alpha transparency, and writes per-character asset directories
// with a manifest.json matching comic-threads/docs/DESIGN.md §4.3.
//
// Usage: node extract.mjs [inputDir] [outputDir]
//   defaults: input  = <repo>/v1.0-pre-modern/comicart/avatars
//             output = <repo>/comic-threads/assets/characters

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeDIB } from './lib/dib.mjs';
import { encodePNG } from './lib/png.mjs';
import { parseAVB } from './lib/avb.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULT_INPUT = path.join(REPO_ROOT, 'v1.0-pre-modern', 'comicart', 'avatars');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'comic-threads', 'assets', 'characters');

const inputDir = path.resolve(process.argv[2] || DEFAULT_INPUT);
const outputDir = path.resolve(process.argv[3] || DEFAULT_OUTPUT);

function round3(x) { return Math.round(x * 1000) / 1000; }

// --- Compositing -----------------------------------------------------------

// Apply a transparency-mask DIB: mirrors bodycam.cpp DrawBody, where the mask
// is MERGEPAINT'd (white = transparent, black = opaque) then the drawing is
// SRCAND'd. Result: mask WHITE -> alpha 0, mask BLACK -> alpha 255.
function applyMask(drawing, mask) {
  const { width: w, height: h, rgb } = drawing;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x);
      let alpha = 255;
      if (x < mask.width && y < mask.height) {
        const mi = (y * mask.width + x) * 3;
        const lum = 0.299 * mask.rgb[mi] + 0.587 * mask.rgb[mi + 1] + 0.114 * mask.rgb[mi + 2];
        alpha = lum >= 128 ? 0 : 255;
      }
      rgba[di * 4] = rgb[di * 3];
      rgba[di * 4 + 1] = rgb[di * 3 + 1];
      rgba[di * 4 + 2] = rgb[di * 3 + 2];
      rgba[di * 4 + 3] = alpha;
    }
  }
  return rgba;
}

// Fallback when a pose has no mask DIB: the original composites such poses with
// SRCAND against a white panel background, so background regions are white in
// the drawing itself. Flood white from the borders so only the exterior (not
// white pixels interior to the character) becomes transparent.
function applyWhiteFloodFallback(drawing) {
  const { width: w, height: h, rgb } = drawing;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  const isWhite = (i) => rgb[i * 3] >= 248 && rgb[i * 3 + 1] >= 248 && rgb[i * 3 + 2] >= 248;
  const visited = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) {
    stack.push(x); stack.push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w); stack.push(y * w + (w - 1));
  }
  while (stack.length) {
    const i = stack.pop();
    if (visited[i]) continue;
    visited[i] = 1;
    if (!isWhite(i)) continue;
    rgba[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  return rgba;
}

// --- Extraction ------------------------------------------------------------

function extractOne(buf, name, sourceRel, outDir, stats) {
  const av = parseAVB(buf);
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = {
    name,
    source: sourceRel,
    type: av.type,
    iconImage: 'icon.png',
  };

  // Cache decoded RGBA per (fgnd:trans) so ditto records share one PNG.
  const imageCache = new Map();

  const decodePoseImage = (pose, prefix, counterRef) => {
    const key = `${pose.fgndOffset}:${pose.transOffset}`;
    if (imageCache.has(key)) return imageCache.get(key);

    const drawing = decodeDIB(buf, pose.fgndOffset);
    let rgba, usedMask = false, usedFallback = false;
    if (pose.transOffset) {
      try {
        const mask = decodeDIB(buf, pose.transOffset);
        rgba = applyMask(drawing, mask);
        usedMask = true;
      } catch (e) {
        rgba = applyWhiteFloodFallback(drawing);
        usedFallback = true;
      }
    } else {
      rgba = applyWhiteFloodFallback(drawing);
      usedFallback = true;
    }

    const file = `${prefix}-${String(counterRef.n++).padStart(2, '0')}.png`;
    fs.writeFileSync(path.join(outDir, file), encodePNG(drawing.width, drawing.height, rgba));
    if (usedMask) stats.poseMask++;
    if (usedFallback) stats.poseFallback++;
    const rec = { file, w: drawing.width, h: drawing.height };
    imageCache.set(key, rec);
    return rec;
  };

  // Icon (no mask offset per LoadIconRec).
  let iconOk = false;
  if (av.iconOffset) {
    try {
      const icon = decodeDIB(buf, av.iconOffset);
      const rgba = applyWhiteFloodFallback(icon);
      fs.writeFileSync(path.join(outDir, 'icon.png'), encodePNG(icon.width, icon.height, rgba));
      iconOk = true;
    } catch (e) {
      stats.warnings.push(`${name}: icon decode failed (${e.message})`);
    }
  }
  if (!iconOk) manifest.iconImage = null;

  const contact = []; // { image, label } for the contact sheet

  if (av.type === 'simple') {
    const counter = { n: 0 };
    manifest.bodies = av.bodies.map((b) => {
      const img = decodePoseImage(b.pose, 'body', counter);
      contact.push({ image: img.file, label: `${b.emotion} ${round3(b.intensity)}` });
      return {
        image: img.file, w: img.w, h: img.h,
        emotion: b.emotion, intensity: round3(b.intensity),
        faceX: b.faceX, faceY: b.faceY,
      };
    });
  } else {
    const fc = { n: 0 };
    manifest.faces = av.faces.map((f) => {
      const img = decodePoseImage(f.pose, 'face', fc);
      contact.push({ image: img.file, label: `face ${f.emotion} ${round3(f.intensity)}` });
      return {
        image: img.file, w: img.w, h: img.h,
        emotion: f.emotion, intensity: round3(f.intensity),
        xCX: f.xCX, yCX: f.yCX, dxCX: f.dxCX, dyCX: f.dyCX,
        faceX: f.faceX, faceY: f.faceY,
      };
    });
    const tc = { n: 0 };
    manifest.torsos = av.torsos.map((t) => {
      const img = decodePoseImage(t.pose, 'torso', tc);
      contact.push({ image: img.file, label: `torso ${t.emotion} ${round3(t.intensity)}` });
      return {
        image: img.file, w: img.w, h: img.h,
        emotion: t.emotion, intensity: round3(t.intensity),
        xCX: t.xCX, yCX: t.yCX,
      };
    });
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return { manifest, contact, internalName: av.name, flags: av.flags, style: av.style };
}

// --- Contact sheet ---------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildContactSheet(entries) {
  const sections = entries.map(({ name, manifest, contact }) => {
    const icon = manifest.iconImage
      ? `<img class="icon" src="${esc(name)}/${esc(manifest.iconImage)}" alt="icon">` : '';
    const cells = contact.map((c) =>
      `<figure><img src="${esc(name)}/${esc(c.image)}" alt="${esc(c.label)}">` +
      `<figcaption>${esc(c.label)}<br><span class="fn">${esc(c.image)}</span></figcaption></figure>`
    ).join('\n');
    return `<section>
  <h2>${icon}${esc(name)} <span class="meta">(${esc(manifest.type)}, ${contact.length} poses)</span></h2>
  <div class="grid">${cells}</div>
</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comic Threads — AVB extraction contact sheet</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #2b2b3a; color: #eee; }
  header { padding: 16px 24px; background: #1c1c28; position: sticky; top: 0; z-index: 1; }
  header h1 { margin: 0; font-size: 18px; }
  header p { margin: 4px 0 0; color: #aaa; font-size: 13px; }
  section { padding: 8px 24px 24px; border-bottom: 1px solid #444; }
  h2 { font-size: 16px; display: flex; align-items: center; gap: 8px; }
  h2 .meta { color: #999; font-weight: normal; font-size: 13px; }
  .icon { width: 32px; height: 32px; image-rendering: pixelated;
          background: repeating-conic-gradient(#666 0 25%, #777 0 50%) 0/12px 12px; }
  .grid { display: flex; flex-wrap: wrap; gap: 10px; }
  figure { margin: 0; width: 130px; background: #383848; border-radius: 6px; padding: 6px;
           display: flex; flex-direction: column; align-items: center; }
  figure img { max-width: 120px; image-rendering: pixelated;
               background: repeating-conic-gradient(#bbb 0 25%, #ddd 0 50%) 0/16px 16px; }
  figcaption { font-size: 11px; text-align: center; margin-top: 4px; color: #ddd; }
  figcaption .fn { color: #8a8; font-size: 10px; }
</style>
</head>
<body>
<header>
  <h1>Comic Threads — AVB extraction contact sheet</h1>
  <p>Every extracted pose for every character, on a checkerboard so alpha is visible. For visual QA only.</p>
</header>
${sections}
</body>
</html>
`;
}

// --- Main ------------------------------------------------------------------

function main() {
  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const files = fs.readdirSync(inputDir).filter((f) => f.toLowerCase().endsWith('.avb')).sort();
  console.log(`Found ${files.length} .avb files in ${inputDir}`);

  const stats = { poseMask: 0, poseFallback: 0, warnings: [] };
  const entries = [];
  const succeeded = [];
  const failed = [];

  for (const file of files) {
    const name = path.basename(file, path.extname(file));
    const outDir = path.join(outputDir, name);
    const sourceRel = path.posix.join('v1.0-pre-modern', 'comicart', 'avatars', file);
    try {
      const buf = fs.readFileSync(path.join(inputDir, file));
      const { manifest, contact, internalName, flags } = extractOne(buf, name, sourceRel, outDir, stats);
      const poseCount = contact.length;
      succeeded.push({ name, poseCount, type: manifest.type, internalName, flags });
      entries.push({ name, manifest, contact });
      console.log(`  ✓ ${name} (${manifest.type}, ${poseCount} poses, internal="${internalName}", flags=${flags})`);
    } catch (e) {
      failed.push({ name, error: e.message });
      console.log(`  ✗ ${name}: ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(outputDir, 'contact-sheet.html'), buildContactSheet(entries));

  console.log('\n=== Summary ===');
  console.log(`Succeeded: ${succeeded.length}/${files.length}`);
  for (const s of succeeded) console.log(`  ${s.name}: ${s.poseCount} poses (${s.type})`);
  if (failed.length) {
    console.log(`Failed: ${failed.length}`);
    for (const f of failed) console.log(`  ${f.name}: ${f.error}`);
  }
  console.log(`Poses using real mask: ${stats.poseMask}; using white-flood fallback: ${stats.poseFallback}`);
  if (stats.warnings.length) {
    console.log('Warnings:');
    for (const w of stats.warnings) console.log(`  ${w}`);
  }
  console.log(`Contact sheet: ${path.join(outputDir, 'contact-sheet.html')}`);
}

main();
