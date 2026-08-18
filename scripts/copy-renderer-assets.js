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
  [path.join(ROOT, 'node_modules', 'marked', 'lib', 'marked.umd.js'), path.join(DEST, 'marked.umd.js')],
];

for (const [from, to] of assets) {
  copyFileSync(from, to);
  console.log(`  ✓ ${path.basename(from)} → dist-renderer/`);
}
