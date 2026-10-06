#!/usr/bin/env tsx
/**
 * Generate an on-brand favicon set from the app's own design tokens.
 *
 * Light mode: cream paper + charcoal ink outline + terminal-green wordmark.
 * Plus a 16px variant for older clients that want a tiny icon.
 *
 * Produces (PNG favicons — no ICO in this sharp build; browsers accept PNG rel=icon):
 *   public/icon-16.png  (16px fallback)
 *   public/icon-32.png  (32px primary)
 *   public/icon-48.png  (48px for larger contexts)
 *
 * The 32px PNG is linked as <link rel="icon"> in the root layout.
 *
 * Re-run any time the wordmark, palette, or size breaks.
 */
import sharp from "sharp";


const FONT = "Roboto Condensed";
const FONT_FALLBACK = "Arial Narrow, Impact, sans-serif";

const WORDMARK = "JOBMATCH_AI";

async function renderWordmark(
  size: number,
  bg: string,
  fg: string,
  outline: string,
  outPath: string,
) {
  // Wordmark fills ~78% of the square so it stays legible at tiny sizes.
  const fontSize = Math.max(7, Math.round(size * 0.52));

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${bg}" />
    <!-- soft charcoal ink drop shadow for legibility on any surface -->
    <text
      x="${size / 2}"
      y="${size / 2 + fontSize * 0.32}"
      text-anchor="middle"
      font-family="${FONT}, ${FONT_FALLBACK}"
      font-size="${fontSize}px"
      font-weight="700"
      letter-spacing="0.5px"
      fill="none"
      stroke="${outline}"
      stroke-width="0.9"
      stroke-linejoin="round"
    >${WORDMARK}</text>
    <text
      x="${size / 2}"
      y="${size / 2 + fontSize * 0.32}"
      text-anchor="middle"
      font-family="${FONT}, ${FONT_FALLBACK}"
      font-size="${fontSize}px"
      font-weight="700"
      letter-spacing="0.5px"
      fill="${fg}"
    >${WORDMARK}</text>
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outPath);
}

async function main() {
  const lightBg = "#f4f0e6";     // --paper (light)
  const lightFg = "#2c5a3c";    // --term-deep (light)
  const outline = "#1c1b18";   // --ink (light), soft charcoal outline

  const sizes = [16, 32, 48];

  for (const size of sizes) {
    const out = `public/icon-${size}.png`;
    await renderWordmark(size, lightBg, lightFg, outline, out);
    console.log(`wrote ${out}`);
  }

  // 32px serves as the ico master for a multi-res ico.
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
