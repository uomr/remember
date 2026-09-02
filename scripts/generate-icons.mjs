/**
 * One-time icon build. Rasterizes the SVG masters in public/icons/ into the PNG
 * sizes referenced by public/manifest.webmanifest and the app <head>.
 *
 * Run after editing icon.svg / icon-maskable.svg:
 *   node scripts/generate-icons.mjs
 *
 * Requires the `sharp` devDependency. This is build tooling only — the running
 * app never imports it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');

const anySvg = await readFile(join(iconsDir, 'icon.svg'));
const maskableSvg = await readFile(join(iconsDir, 'icon-maskable.svg'));

/** [source svg, output file, pixel size] */
const targets = [
  [anySvg, 'icon-192.png', 192],
  [anySvg, 'icon-512.png', 512],
  [maskableSvg, 'icon-maskable-512.png', 512],
  [anySvg, 'apple-touch-icon.png', 180],
  [anySvg, 'favicon-32.png', 32],
];

for (const [svg, name, size] of targets) {
  const out = join(iconsDir, name);
  await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  console.log(`wrote ${name} (${size}x${size})`);
}

console.log('DONE');
