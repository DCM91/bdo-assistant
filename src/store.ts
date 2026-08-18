import { existsSync, readFileSync, writeFileSync, openSync, closeSync, readSync, fstatSync, readdirSync } from 'fs';
import { config } from './config';
import { IndexEmptyError, MigrationRequiredError, StoreCorruptedError } from './errors';
import { cosineSimilarityRow, l2Norm } from './similarity';
import type { Chunk, ChunkSource, IndexFileV2, ScoredChunk } from './types';

export interface StoreStats {
  chunks: number;
  uniqueUrls: number;
  scrapedFiles: number;
  latestDate: string | null;
  oldestDate: string | null;
  dims: number;
  /** Chunks desglosados por fuente (garmoth, bdo, ...). */
  bySource: Record<string, number>;
}

const MAGIC = 0x454f4442; // "BDOE" little-endian
const BIN_VERSION = 1;
const HEADER_BYTES = 16; // magic + version + dims + count (4 × uint32)

/**
 * Store singleton: carga el índice una vez en memoria y lo mantiene cacheado.
 * Los embeddings viven en un único Float32Array (vista sobre el archivo binario),
 * sin copiarse a objetos JS por chunk.
 */
class Store {
  private chunks: Chunk[] = [];
  private embeddings: Float32Array = new Float32Array(0);
  private dims: number = config.ollama.embedDims;
  private loaded = false;

  /** Carga index.json + embeddings.bin. Lanza MigrationRequiredError si está en formato v1. */
  load(): void {
    const { indexFile, embeddingsFile } = config.paths;

    if (!existsSync(indexFile)) {
      this.chunks = [];
      this.embeddings = new Float32Array(0);
      this.loaded = true;
      return;
    }

    const raw = JSON.parse(readFileSync(indexFile, 'utf-8')) as unknown;

    // Formato v1: array plano con campo "embedding" por chunk
    if (Array.isArray(raw)) {
      if (raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && 'embedding' in raw[0]) {
        throw new MigrationRequiredError(
          'data/index.json está en formato antiguo (v1). Ejecuta: npm run migrate',
        );
      }
      // v1 vacío: tratar como índice vacío
      this.chunks = [];
      this.embeddings = new Float32Array(0);
      this.loaded = true;
      return;
    }

    const index = raw as IndexFileV2;
    if (index.version !== 2 || !Array.isArray(index.chunks)) {
      throw new StoreCorruptedError('data/index.json tiene un formato desconocido');
    }

    this.dims = index.dims;

    if (index.chunks.length === 0) {
      this.chunks = [];
      this.embeddings = new Float32Array(0);
      this.loaded = true;
      return;
    }

    if (!existsSync(embeddingsFile)) {
      throw new StoreCorruptedError(
        'index.json tiene ' + index.chunks.length + ' chunks pero no existe embeddings.bin. Ejecuta: npm run migrate',
      );
    }

    const fd = openSync(embeddingsFile, 'r');
    try {
      const size = fstatSync(fd).size;
      const buffer = Buffer.alloc(size);
      readSync(fd, buffer, 0, size, 0);

      if (size < HEADER_BYTES || buffer.readUInt32LE(0) !== MAGIC) {
        throw new StoreCorruptedError('embeddings.bin: cabecera inválida');
      }
      const binDims = buffer.readUInt32LE(8);
      const binCount = buffer.readUInt32LE(12);

      if (binDims !== index.dims) {
        throw new StoreCorruptedError(`embeddings.bin dims=${binDims} pero index.json dims=${index.dims}`);
      }
      if (binCount !== index.chunks.length) {
        throw new StoreCorruptedError(
          `embeddings.bin tiene ${binCount} vectores pero index.json tiene ${index.chunks.length} chunks`,
        );
      }
      const expected = HEADER_BYTES + binCount * binDims * 4;
      if (size !== expected) {
        throw new StoreCorruptedError(`embeddings.bin: tamaño ${size}, esperado ${expected}`);
      }

      // Vista sobre el buffer, sin copia. OJO: al hacer append se sustituye.
      this.embeddings = new Float32Array(buffer.buffer, buffer.byteOffset + HEADER_BYTES, binCount * binDims);
      this.chunks = normalizeChunks(index.chunks);
      this.loaded = true;
    } finally {
      closeSync(fd);
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  /** Recarga desde disco (tras indexar o migrar). */
  reload(): void {
    this.loaded = false;
    this.load();
  }

  get count(): number {
    this.ensureLoaded();
    return this.chunks.length;
  }

  get dimensions(): number {
    return this.dims;
  }

  isEmpty(): boolean {
    this.ensureLoaded();
    return this.chunks.length === 0;
  }

  getChunk(pos: number): Chunk {
    this.ensureLoaded();
    return this.chunks[pos];
  }

  getAllChunks(): Chunk[] {
    this.ensureLoaded();
    return this.chunks;
  }

  /** Embedding de un chunk como vista (no copiar). */
  getEmbedding(pos: number): Float32Array {
    this.ensureLoaded();
    const offset = pos * this.dims;
    return this.embeddings.subarray(offset, offset + this.dims);
  }

  /** URLs ya indexadas (para indexado incremental). */
  getIndexedUrls(): Set<string> {
    this.ensureLoaded();
    return new Set(this.chunks.map((c) => c.url));
  }

  /**
   * Puntúa todos los chunks contra el embedding de consulta.
   * Itera directamente sobre el Float32Array sin copias.
   */
  scoreAll(queryEmbedding: ArrayLike<number>): ScoredChunk[] {
    this.ensureLoaded();
    const n = this.chunks.length;
    if (n === 0) throw new IndexEmptyError('No hay datos indexados. Ejecuta /scrape primero.');

    const qNorm = l2Norm(queryEmbedding);
    const scored: ScoredChunk[] = new Array(n);
    for (let i = 0; i < n; i++) {
      scored[i] = {
        ...this.chunks[i],
        pos: i,
        score: cosineSimilarityRow(queryEmbedding, this.embeddings, i, this.dims, qNorm),
      };
    }
    return scored;
  }

  /**
   * Añade chunks nuevos con sus embeddings: append binario + reescritura de index.json.
   * Invalida la caché en memoria (hay que hacer reload).
   */
  appendChunks(newChunks: Chunk[], newEmbeddings: number[][]): void {
    if (newChunks.length !== newEmbeddings.length) {
      throw new StoreCorruptedError('appendChunks: chunks y embeddings no coinciden');
    }
    if (newChunks.length === 0) return;

    this.ensureLoaded();

    const totalChunks = this.chunks.length + newChunks.length;
    const dims = this.dims;

    // Escribir embeddings.bin completo (antiguo + nuevo). Es O(total) pero
    // binario puro: ~100 MB/s. Suficiente para volúmenes de scraping web.
    const out = Buffer.alloc(HEADER_BYTES + totalChunks * dims * 4);
    out.writeUInt32LE(MAGIC, 0);
    out.writeUInt32LE(BIN_VERSION, 4);
    out.writeUInt32LE(dims, 8);
    out.writeUInt32LE(totalChunks, 12);

    // Copiar embeddings existentes
    const existing = Buffer.from(this.embeddings.buffer, this.embeddings.byteOffset, this.embeddings.length * 4);
    existing.copy(out, HEADER_BYTES);

    // Añadir los nuevos
    let offset = HEADER_BYTES + this.embeddings.length * 4;
    for (const emb of newEmbeddings) {
      if (emb.length !== dims) {
        throw new StoreCorruptedError(`Embedding con dims=${emb.length}, esperado ${dims}`);
      }
      for (let i = 0; i < dims; i++) {
        out.writeFloatLE(emb[i], offset + i * 4);
      }
      offset += dims * 4;
    }
    writeFileSync(config.paths.embeddingsFile, out);

    // Reescribir index.json con todos los chunks
    const index: IndexFileV2 = {
      version: 2,
      dims,
      chunks: [...this.chunks, ...newChunks],
    };
    writeFileSync(config.paths.indexFile, JSON.stringify(index), 'utf-8');

    this.loaded = false;
  }

  /** Reemplaza todo el índice (usado por --reindex). */
  replaceAll(chunks: Chunk[], embeddings: number[][]): void {
    const { indexFile, embeddingsFile } = config.paths;
    if (existsSync(indexFile)) writeFileSync(indexFile, JSON.stringify({ version: 2, dims: this.dims, chunks: [] }));
    if (existsSync(embeddingsFile)) writeFileSync(embeddingsFile, Buffer.alloc(0));
    this.chunks = [];
    this.embeddings = new Float32Array(0);
    this.loaded = true;
    this.appendChunks(chunks, embeddings);
  }
}

/**
 * Normaliza chunks cargados del disco, rellenando los campos nuevos
 * (source, canonical_url) en chunks antiguos que no los tengan.
 */
function normalizeChunks(raw: Chunk[]): Chunk[] {
  return raw.map((c) => ({
    ...c,
    source: (c.source ?? 'garmoth') as ChunkSource,
    canonical_url: c.canonical_url ?? canonicalUrlLocal(c.url),
  }));
}

/**
 * Versión local de canonicalUrl (idéntica a la del scraper).
 * La duplicamos aquí para no importar el módulo scraper (que arrastra playwright).
 */
function canonicalUrlLocal(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.host = u.host.toLowerCase().replace(/^www\./, '');
    const tracking = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid'];
    tracking.forEach((p) => u.searchParams.delete(p));
    let p = u.pathname;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    u.pathname = p;
    return u.toString();
  } catch {
    return url;
  }
}

/** Instancia única para toda la app. */
export const store = new Store();

/** Estadísticas agregadas del índice + carpeta de scrapeo (para la UI). */
export function getStats(): StoreStats {
  store.load();
  const chunks = store.getAllChunks();

  let scrapedFiles = 0;
  if (existsSync(config.paths.scrapedDir)) {
    scrapedFiles = readdirSync(config.paths.scrapedDir).filter((f) => f.endsWith('.json')).length;
  }

  let latestDate: string | null = null;
  let oldestDate: string | null = null;
  if (chunks.length > 0) {
    const dates = chunks.map((c) => c.scraped_at).filter(Boolean).sort();
    if (dates.length > 0) {
      oldestDate = dates[0].split('T')[0];
      latestDate = dates[dates.length - 1].split('T')[0];
    }
  }

  const bySource: Record<string, number> = {};
  for (const c of chunks) {
    bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  }

  return {
    chunks: chunks.length,
    uniqueUrls: new Set(chunks.map((c) => c.url)).size,
    scrapedFiles,
    latestDate,
    oldestDate,
    dims: store.dimensions,
    bySource,
  };
}

// ---------------------------------------------------------------------------
// Caché de embeddings de consultas (TTL + LRU)
// ---------------------------------------------------------------------------

interface CacheEntry {
  embedding: number[];
  ts: number;
}

class QueryEmbeddingCache {
  private map = new Map<string, CacheEntry>();

  private key(question: string): string {
    return question.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  get(question: string): number[] | null {
    const k = this.key(question);
    const entry = this.map.get(k);
    if (!entry) return null;
    if (Date.now() - entry.ts > config.queryCache.ttlMs) {
      this.map.delete(k);
      return null;
    }
    // LRU: reinsertar al final
    this.map.delete(k);
    this.map.set(k, entry);
    return entry.embedding;
  }

  set(question: string, embedding: number[]): void {
    const k = this.key(question);
    this.map.delete(k);
    this.map.set(k, { embedding, ts: Date.now() });
    while (this.map.size > config.queryCache.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

export const queryEmbeddingCache = new QueryEmbeddingCache();
