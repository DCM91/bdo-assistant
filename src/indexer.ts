import { existsSync, readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { config } from './config';
import { chunkBySentences } from './chunker';
import { embedBatch } from './ollama';
import { store } from './store';
import { canonicalUrl } from './scraper';
import { MigrationRequiredError } from './errors';
import type { Chunk, ChunkSource, ScrapedPage } from './types';

export interface IndexResult {
  newChunks: number;
  totalChunks: number;
  filesProcessed: number;
  filesSkipped: number;
}

/**
 * Indexa todos los archivos de data/scraped/ que aún no estén en el índice.
 * Usa /api/embed por lotes (batch) y persiste en index.json + embeddings.bin.
 *
 * @param reindex Si true, ignora el índice actual y re-procesa todo desde cero.
 */
export async function indexAll(reindex = false): Promise<IndexResult> {
  console.log('📄 Leyendo archivos scrapeados...');

  const scrapedDir = config.paths.scrapedDir;
  if (!existsSync(scrapedDir)) {
    console.log('⚠ No existe data/scraped/. Ejecuta /scrape primero.');
    return { newChunks: 0, totalChunks: 0, filesProcessed: 0, filesSkipped: 0 };
  }

  const files = readdirSync(scrapedDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('⚠ No hay archivos scrapeados aún. Ejecuta /scrape primero.');
    return { newChunks: 0, totalChunks: 0, filesProcessed: 0, filesSkipped: 0 };
  }
  console.log(`  ${files.length} archivos encontrados`);

  // Cargar store (puede lanzar MigrationRequiredError si está en v1)
  try {
    store.load();
  } catch (e) {
    if (e instanceof MigrationRequiredError) {
      console.log('⚠ ' + e.message);
      return { newChunks: 0, totalChunks: 0, filesProcessed: 0, filesSkipped: 0 };
    }
    throw e;
  }

  if (reindex) {
    console.log('♻  Modo --reindex: se re-procesarán todas las URLs con el chunker actual');
    store.replaceAll([], []);
  }

  const indexedUrls = store.getIndexedUrls();
  // Set adicional de URLs canónicas para deduplicación. Usamos el canonical_url
  // ya almacenado (los chunks nuevos lo llevan; los legacy se rellenan en
  // `Store.normalizeChunks`).
  const indexedCanonical = new Set<string>(
    store.getAllChunks().map((c) => c.canonical_url),
  );
  if (indexedUrls.size > 0) {
    console.log(`  ${store.count} chunks ya indexados (${indexedUrls.size} URLs)`);
  }

  let totalNew = 0;
  let processed = 0;
  let skipped = 0;

  for (const file of files) {
    const fullPath = path.join(scrapedDir, file);

    let page: ScrapedPage;
    try {
      page = JSON.parse(readFileSync(fullPath, 'utf-8')) as ScrapedPage;
    } catch (e) {
      console.log(`  ✗ Saltando ${file} (JSON inválido: ${e instanceof Error ? e.message : e})`);
      skipped++;
      continue;
    }

    if (!page.url || !page.scraped_at) {
      console.log(`  ✗ Saltando ${file} (sin url o scraped_at)`);
      skipped++;
      continue;
    }

    const pageCanonical = canonicalUrl(page.url);
    if (indexedUrls.has(page.url) || indexedCanonical.has(pageCanonical)) {
      skipped++;
      continue;
    }
    if (!page.text || page.text.length < 50) {
      skipped++;
      continue;
    }

    const texts = chunkBySentences(page.text.substring(0, config.chunker.maxInputChars));
    if (texts.length === 0) {
      skipped++;
      continue;
    }

    console.log(`  🔤 ${page.title || page.url} → ${texts.length} chunks`);

    // Embeddings por lotes
    const batchSize = config.ollama.embedBatchSize;
    const embeddings: number[][] = [];
    let failed = false;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      process.stdout.write(
        `    embeddings ${Math.min(i + batchSize, texts.length)}/${texts.length}\r`,
      );
      try {
        const result = await embedBatch(batch);
        embeddings.push(...result);
      } catch (e) {
        console.log(
          `\n    ✗ Error en lote ${Math.floor(i / batchSize) + 1}: ${e instanceof Error ? e.message : e}`,
        );
        failed = true;
        break;
      }
    }

    if (failed) {
      // NO persistimos embeddings parciales: si lo hiciéramos, esta página
      // quedaría marcada como indexada y sus chunks restantes nunca se procesarían.
      console.log(
        '    ⚠ Saltando esta página. Embeddings no persistidos. Reindex con --reindex para reintentar.',
      );
      skipped++;
      continue;
    }

    const chunks = buildChunks(page, texts);
    store.appendChunks(chunks, embeddings);
    store.reload();
    totalNew += chunks.length;
    processed++;
    indexedUrls.add(page.url);
    indexedCanonical.add(chunks[0].canonical_url);
  }

  console.log(
    `\n✅ Indexado completado: +${totalNew} chunks nuevos (total: ${store.count})` +
      (skipped > 0 ? `, ${skipped} archivos omitidos` : ''),
  );

  return { newChunks: totalNew, totalChunks: store.count, filesProcessed: processed, filesSkipped: skipped };
}

function buildChunks(page: ScrapedPage, texts: string[]): Chunk[] {
  const now = new Date().toISOString();
  const canonical = canonicalUrl(page.url);
  // Compatibilidad hacia atrás: archivos JSON antiguos (pre-multi-sitio) no tienen site_id.
  const source: ChunkSource = (page.site_id ?? 'garmoth') as ChunkSource;
  return texts.map((text, i) => ({
    id: `${page.url}_${i}`,
    url: page.url,
    title: page.title || page.url,
    text,
    scraped_at: page.scraped_at,
    indexed_at: now,
    source,
    canonical_url: canonical,
  }));
}

if (require.main === module) {
  const reindex = process.argv.includes('--reindex');
  indexAll(reindex).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
