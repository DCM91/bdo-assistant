import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, readSync, fstatSync, readdirSync } from 'fs';
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

/** Página indexada (URL única con su metadato agregado) — para el modal de Páginas. */
export interface IndexedPage {
  url: string;
  title: string;
  source: ChunkSource;
  scraped_at: string;
  chunks: number;
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

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(indexFile, 'utf-8'));
    } catch (e) {
      throw new StoreCorruptedError(
        `data/index.json no se pudo parsear: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

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
        'index.json tiene ' +
          index.chunks.length +
          ' chunks pero no existe embeddings.bin. Reindexa con: npx tsx src/indexer.ts --reindex',
      );
    }

    const fd = openSync(embeddingsFile, 'r');
    try {
      const size = fstatSync(fd).size;
      const buffer = Buffer.alloc(size);
      let bytesRead = 0;
      while (bytesRead < size) {
        const r = readSync(fd, buffer, bytesRead, size - bytesRead, bytesRead);
        if (r === 0) break;
        bytesRead += r;
      }
      if (bytesRead !== size) {
        throw new StoreCorruptedError(`embeddings.bin: lectura incompleta (${bytesRead}/${size})`);
      }

      if (size < HEADER_BYTES || buffer.readUInt32LE(0) !== MAGIC) {
        throw new StoreCorruptedError('embeddings.bin: cabecera inválida');
      }
      const binVersion = buffer.readUInt32LE(4);
      const binDims = buffer.readUInt32LE(8);
      const binCount = buffer.readUInt32LE(12);

      if (binVersion !== BIN_VERSION) {
        throw new StoreCorruptedError(
          `embeddings.bin: versión de bin ${binVersion} no soportada (esperada ${BIN_VERSION})`,
        );
      }
      if (binDims !== index.dims) {
        throw new StoreCorruptedError(`embeddings.bin dims=${binDims} pero index.json dims=${index.dims}`);
      }
      if (binDims !== config.ollama.embedDims) {
        throw new StoreCorruptedError(
          `embeddings.bin tiene dims=${binDims} pero config.ollama.embedDims=${config.ollama.embedDims}. Reindexa con --reindex.`,
        );
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
   * Lista de páginas únicas indexadas, agregadas por URL: cuenta de chunks,
   * fuente (source) y fecha de scrape más reciente.
   */
  getIndexedPages(): IndexedPage[] {
    this.ensureLoaded();
    const byUrl = new Map<string, IndexedPage>();
    for (const c of this.chunks) {
      const prev = byUrl.get(c.url);
      if (prev) {
        prev.chunks++;
        if (c.scraped_at > prev.scraped_at) prev.scraped_at = c.scraped_at;
      } else {
        byUrl.set(c.url, {
          url: c.url,
          title: c.title,
          source: c.source,
          scraped_at: c.scraped_at,
          chunks: 1,
        });
      }
    }
    return Array.from(byUrl.values()).sort((a, b) => b.scraped_at.localeCompare(a.scraped_at));
  }

  /**
   * Elimina todos los chunks de una URL del índice (atómico vía `writeIndex`).
   * Devuelve el número de chunks eliminados. El archivo JSON scrapeado en disco
   * no se modifica — el usuario decide cuándo borrarlo.
   */
  removeByUrl(url: string): number {
    this.ensureLoaded();
    const keep: Chunk[] = [];
    let removed = 0;
    for (const c of this.chunks) {
      if (c.url === url) {
        removed++;
      } else {
        keep.push(c);
      }
    }
    if (removed === 0) return 0;
    const keepEmbeddings = this.getAllEmbeddings().filter(
      (_e, i) => this.chunks[i].url !== url,
    );
    this.writeIndex(keep, keepEmbeddings);
    return removed;
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

  /** Devuelve todos los embeddings actuales materializados como number[][]. Costoso: O(N·D). */
  private getAllEmbeddings(): number[][] {
    this.ensureLoaded();
    const n = this.chunks.length;
    const result: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = Array.from(this.getEmbedding(i));
    }
    return result;
  }

  /**
   * Escribe `embeddings.bin` + `index.json` de forma atómica vía `*.tmp` + `renameSync`.
   * El commit son los dos `renameSync` finales; si el proceso muere entre ellos,
   * `load()` siguiente detectará el desajuste count/dims y lanzará `StoreCorruptedError`.
   */
  private writeIndex(chunks: Chunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
      throw new StoreCorruptedError('writeIndex: chunks y embeddings no coinciden');
    }
    const { indexFile, embeddingsFile } = config.paths;
    const dims = this.dims;
    const count = chunks.length;

    const idxTmp = `${indexFile}.tmp`;
    const binTmp = `${embeddingsFile}.tmp`;

    const bin = Buffer.alloc(HEADER_BYTES + count * dims * 4);
    bin.writeUInt32LE(MAGIC, 0);
    bin.writeUInt32LE(BIN_VERSION, 4);
    bin.writeUInt32LE(dims, 8);
    bin.writeUInt32LE(count, 12);
    let off = HEADER_BYTES;
    for (const emb of embeddings) {
      if (emb.length !== dims) {
        throw new StoreCorruptedError(`Embedding con dims=${emb.length}, esperado ${dims}`);
      }
      for (let i = 0; i < dims; i++) {
        bin.writeFloatLE(emb[i], off + i * 4);
      }
      off += dims * 4;
    }
    writeFileSync(binTmp, bin);
    writeFileSync(idxTmp, JSON.stringify({ version: 2, dims, chunks }));
    renameSync(binTmp, embeddingsFile);
    renameSync(idxTmp, indexFile);

    this.loaded = false;
  }

  /**
   * Añade chunks nuevos con sus embeddings. Escritura atómica: hasta el commit
   * (los dos `renameSync` finales), el contenido anterior permanece intacto.
   */
  appendChunks(newChunks: Chunk[], newEmbeddings: number[][]): void {
    if (newChunks.length !== newEmbeddings.length) {
      throw new StoreCorruptedError('appendChunks: chunks y embeddings no coinciden');
    }
    if (newChunks.length === 0) return;
    this.ensureLoaded();

    const existing = this.getAllEmbeddings();
    this.writeIndex([...this.chunks, ...newChunks], [...existing, ...newEmbeddings]);
  }

  /**
   * Reemplaza todo el índice (usado por --reindex). Atómico: la versión previa
   * permanece hasta el commit final; nunca se truncan archivos en sitio.
   */
  replaceAll(chunks: Chunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
      throw new StoreCorruptedError('replaceAll: chunks y embeddings no coinciden');
    }
    this.writeIndex(chunks, embeddings);
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
