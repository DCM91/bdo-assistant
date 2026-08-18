/**
 * Migración one-shot: convierte data/index.json v1 (embeddings inline en JSON)
 * al formato v2: index.json (solo metadatos) + embeddings.bin (Float32 binario).
 *
 * Uso: npm run migrate
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { config } from './config';
import type { ChunkV1, IndexFileV2 } from './types';

const MAGIC = 0x454f4442; // "BDOE"
const BIN_VERSION = 1;
const HEADER_BYTES = 16;

function migrate(): void {
  const { indexFile, embeddingsFile } = config.paths;

  if (!existsSync(indexFile)) {
    console.log('No existe data/index.json. Nada que migrar.');
    return;
  }

  const raw = JSON.parse(readFileSync(indexFile, 'utf-8')) as unknown;

  if (!Array.isArray(raw)) {
    console.log('data/index.json ya está en formato v2. Nada que hacer.');
    return;
  }

  const oldChunks = raw as ChunkV1[];
  if (oldChunks.length === 0 || !('embedding' in (oldChunks[0] ?? {}))) {
    console.log('Índice vacío. Se reescribe en formato v2 vacío.');
    const empty: IndexFileV2 = { version: 2, dims: config.ollama.embedDims, chunks: [] };
    writeFileSync(indexFile, JSON.stringify(empty));
    return;
  }

  console.log(`Migrando ${oldChunks.length} chunks a formato v2...`);

  // Backup del original
  const backup = indexFile + '.v1.bak';
  copyFileSync(indexFile, backup);
  console.log(`  Backup creado: ${backup}`);

  const dims = oldChunks[0].embedding.length;
  const out = Buffer.alloc(HEADER_BYTES + oldChunks.length * dims * 4);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(BIN_VERSION, 4);
  out.writeUInt32LE(dims, 8);
  out.writeUInt32LE(oldChunks.length, 12);

  const chunks = oldChunks.map((c, row) => {
    const base = HEADER_BYTES + row * dims * 4;
    for (let i = 0; i < dims; i++) {
      out.writeFloatLE(c.embedding[i], base + i * 4);
    }
    return {
      id: c.id,
      url: c.url,
      title: c.title,
      text: c.text,
      scraped_at: c.scraped_at,
      indexed_at: c.indexed_at,
      source: 'garmoth' as const,
      canonical_url: c.url,
    };
  });

  writeFileSync(embeddingsFile, out);

  const index: IndexFileV2 = { version: 2, dims, chunks };
  writeFileSync(indexFile, JSON.stringify(index), 'utf-8');

  const binMB = (out.length / 1024 / 1024).toFixed(1);
  console.log(`\n✅ Migración completada:`);
  console.log(`   ${chunks.length} chunks, ${dims} dims`);
  console.log(`   embeddings.bin: ${binMB} MB`);
  console.log(`   index.json: solo metadatos`);
  console.log(`   Backup del v1 en: ${backup}`);
}

if (require.main === module) {
  try {
    migrate();
  } catch (e) {
    console.error('Error en la migración:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

export { migrate };
