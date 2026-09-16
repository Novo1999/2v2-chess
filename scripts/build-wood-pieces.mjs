/**
 * Generates the "Wood" piece set from the Cburnett "Classic" set.
 *
 * Cburnett's pieces are drawn in plain black and white, so a wooden set is a
 * recolouring: white bodies become pale maple, black bodies dark walnut, each
 * with a turned-wood gradient and a fine vertical grain; black outlines become
 * dark brown and the white detail lines on the dark pieces become light tan.
 * Cburnett is available under the BSD license, which permits modified copies
 * with attribution — see src/assets/pieces/wood/README.md.
 *
 *     node scripts/build-wood-pieces.mjs
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const SOURCE = new URL('../src/assets/pieces/cburnett/', import.meta.url);
const TARGET = new URL('../src/assets/pieces/wood/', import.meta.url);

const LIGHT = {
  body: 'url(#wood)',
  stops: ['#f7e1b5', '#e9c790', '#cf9f60'],
  outline: '#3d2410',
  detail: '#3d2410',
  grain: { strength: 0.9, bias: 0.5 },
};
const DARK = {
  body: 'url(#wood)',
  stops: ['#8e5a33', '#6b3f21', '#472813'],
  outline: '#1d110a',
  detail: '#dcb883',
  grain: { strength: 1.2, bias: 0.68 },
};

function defs(palette) {
  const [a, b, c] = palette.stops;
  return `<defs>
  <linearGradient id="wood" x1="0" y1="0" x2="1" y2="0.12">
    <stop offset="0" stop-color="${a}"/>
    <stop offset="0.5" stop-color="${b}"/>
    <stop offset="1" stop-color="${c}"/>
  </linearGradient>
  <filter id="grain" filterUnits="userSpaceOnUse" x="0" y="0" width="45" height="45" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.9 0.03" numOctaves="1" seed="11" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -${palette.grain.strength} ${palette.grain.bias}" result="streaks"/>
    <feComposite in="streaks" in2="SourceAlpha" operator="in" result="grain"/>
    <feBlend in="SourceGraphic" in2="grain" mode="multiply"/>
  </filter>
</defs>`;
}

function woodify(svg, palette) {
  const white = /#(?:ffffff|fff)\b/i;
  const black = /#(?:000000|000)\b/i;
  const recolour = (property, value) => {
    const isFill = property === 'fill';
    if (white.test(value)) return palette === LIGHT && isFill ? palette.body : palette.detail;
    if (black.test(value)) return palette === DARK && isFill ? palette.body : palette.outline;
    return value;
  };

  let out = svg
    // style="fill:#ffffff; stroke:#000000"
    .replace(/\b(fill|stroke)\s*:\s*(#[0-9a-f]{3,6})/gi, (_, p, v) => `${p}:${recolour(p.toLowerCase(), v)}`)
    // fill="#fff" stroke="#000"
    .replace(/\b(fill|stroke)="(#[0-9a-f]{3,6})"/gi, (_, p, v) => `${p}="${recolour(p.toLowerCase(), v)}"`);

  const open = out.match(/<svg\b[^>]*>/);
  if (!open) throw new Error('no <svg> element');
  const at = open.index + open[0].length;
  out = `${out.slice(0, at)}\n${defs(palette)}\n<g filter="url(#grain)">${out.slice(at)}`;
  return out.replace(/<\/svg>\s*$/, '</g>\n</svg>\n');
}

mkdirSync(TARGET, { recursive: true });
const files = readdirSync(SOURCE).filter((f) => /^[wb][KQRBNP]\.svg$/.test(f));
if (files.length !== 12) throw new Error(`expected 12 source pieces, found ${files.length}`);

for (const file of files) {
  const svg = readFileSync(new URL(file, SOURCE), 'utf8');
  writeFileSync(new URL(file, TARGET), woodify(svg, file.startsWith('w') ? LIGHT : DARK));
}
console.log(`wrote ${files.length} wood pieces`);
