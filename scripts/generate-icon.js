/**
 * Genera el icono de la app: ui/build/icon.png (512×512) e icon.ico.
 * Diseño: cuadrado redondeado con gradiente morado→azul y texto "BDO".
 */
const path = require('path');
const { mkdirSync, existsSync, writeFileSync } = require('fs');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default ?? pngToIcoModule;

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'ui', 'build');

const SVG = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7c5cff"/>
      <stop offset="100%" stop-color="#3b2d8f"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#g)"/>
  <text x="50%" y="54%" font-family="Segoe UI, Arial, sans-serif" font-size="168" font-weight="bold"
        fill="#ffffff" text-anchor="middle" dominant-baseline="middle">BDO</text>
</svg>`;

async function main() {
  if (!existsSync(BUILD)) mkdirSync(BUILD, { recursive: true });

  const pngPath = path.join(BUILD, 'icon.png');
  const icoPath = path.join(BUILD, 'icon.ico');

  await sharp(Buffer.from(SVG)).png().toFile(pngPath);
  console.log(`  ✓ ${pngPath}`);

  const ico = await pngToIco(pngPath);
  writeFileSync(icoPath, ico);
  console.log(`  ✓ ${icoPath}`);
}

main().catch((e) => {
  console.error('Error generando icono:', e);
  process.exit(1);
});
