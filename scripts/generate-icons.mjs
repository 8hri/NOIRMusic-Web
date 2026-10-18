/**
 * NOIRMusic Web — app icon generator.
 *
 * Source of truth: `assets/appicon-1024.png` — the approved NOIRMusic app
 * icon (warm ivory field, bronze "N"), copied verbatim from the native
 * repository's AppIcon.appiconset. The artwork is NOT redrawn here; sharp is
 * only used to rasterize it at the sizes the PWA manifest and iOS Home Screen
 * require.
 *
 * `maskable-512.png` pads the composition onto the light background so the
 * mark survives Android's safe-zone cropping; the unpadded sizes are used
 * everywhere else (including iOS, which applies its own mask).
 *
 * Run with: npm run icons
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'public/icons');
const SOURCE = resolve(ROOT, 'assets/appicon-1024.png');

/** Light background token (`--bg` light) — the maskable padding field. */
const LIGHT_BG = '#F3EFE7';

const TARGETS = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon-180.png', size: 180 },
  { name: 'apple-touch-icon-167.png', size: 167 },
  { name: 'favicon-32.png', size: 32 },
];

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Missing source icon: ${SOURCE}`);
    process.exit(1);
  }
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  const source = sharp(SOURCE);

  // Plain sizes: the artwork fills the square; each platform masks it itself.
  for (const target of TARGETS) {
    const png = await source
      .clone()
      .resize(target.size, target.size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(resolve(OUT_DIR, target.name), png);
    console.log('wrote', target.name, `${png.length} bytes`);
  }

  // Maskable: keep the whole mark inside Android's 80% safe zone by scaling
  // the source down and centering it on the background color.
  const safe = 0.8;
  const inner = Math.round(512 * safe);
  const padded = await sharp(SOURCE)
    .resize(inner, inner, { fit: 'cover' })
    .extend({
      top: (512 - inner) / 2,
      bottom: (512 - inner) / 2,
      left: (512 - inner) / 2,
      right: (512 - inner) / 2,
      background: LIGHT_BG,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(resolve(OUT_DIR, 'maskable-512.png'), padded);
  console.log('wrote maskable-512.png', `${padded.length} bytes`);

  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
