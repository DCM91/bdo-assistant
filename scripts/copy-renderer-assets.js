/**
 * Copia los assets estáticos del renderer a dist-renderer/:
 * index.html, styles.css y marked.umd.js (desde node_modules).
 */
const { copyFileSync, mkdirSync, existsSync } = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'dist-renderer');

if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true });

const assets = [
  [path.join(ROOT, 'src', 'ui', 'renderer', 'index.html'), path.join(DEST, 'index.html')],
  [path.join(ROOT, 'src', 'ui', 'renderer', 'styles.css'), path.join(DEST, 'styles.css')],
];

for (const [from, to] of assets) {
  if (!existsSync(from)) {
    throw new Error(`Asset no encontrado: ${from}`);
  }
  copyFileSync(from, to);
  console.log(`  ✓ ${path.basename(from)} → dist-renderer/`);
}

const markedSrc = path.join(ROOT, 'node_modules', 'marked', 'lib', 'marked.umd.js');
const markedDest = path.join(DEST, 'marked.umd.js');
if (!existsSync(markedSrc)) {
  throw new Error(
    `marked.umd.js no encontrado en ${markedSrc}. ¿Versión de marked cambió de layout? ` +
      `npm install para restaurar, o ajusta este script.`,
  );
}
copyFileSync(markedSrc, markedDest);
console.log(`  ✓ marked.umd.js → dist-renderer/`);
