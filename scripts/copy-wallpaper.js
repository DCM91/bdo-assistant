/**
 * Copia el wallpaper del usuario a ui/build/wallpaper.jpg para que
 * electron-builder lo incluya en el .exe como buildResource.
 * Si no existe el archivo en Descargas, no falla (el .exe funcionará sin fondo).
 */
const { copyFileSync, existsSync, mkdirSync } = require('fs');
const path = require('path');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const SRC = path.join(HOME, 'Downloads', 'Wallpaper.jpg');
const DEST = path.join(__dirname, '..', 'ui', 'build', 'wallpaper.jpg');

if (!existsSync(SRC)) {
  console.warn(`⚠ No se encontró ${SRC}. El .exe se empaquetará sin wallpaper.`);
  process.exit(0);
}

mkdirSync(path.dirname(DEST), { recursive: true });
copyFileSync(SRC, DEST);

const sizeMb = (require('fs').statSync(DEST).size / 1024 / 1024).toFixed(1);
console.log(`  ✓ Wallpaper copiado a ${DEST} (${sizeMb} MB)`);