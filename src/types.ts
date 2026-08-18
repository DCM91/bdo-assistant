/** Origen del chunk (para filtrar respuestas por fuente y deduplicación). */
export type ChunkSource = 'garmoth' | 'bdocodex' | 'bdo' | 'wiki' | 'local';

/** Identificador de sitio scrapeado (usado en ScrapedPage.site_id y al prefigurar archivos). */
export type SiteId = 'garmoth' | 'bdo';

/** Chunk indexado: metadatos + referencia a su fila en embeddings.bin (posición en el array). */
export interface Chunk {
  id: string;
  url: string;
  title: string;
  text: string;
  scraped_at: string;
  indexed_at: string;
  /** Fuente del contenido (default 'garmoth' en chunks antiguos). */
  source: ChunkSource;
  /** URL normalizada para deduplicación (sin tracking, host en minúsculas, sin trailing slash). */
  canonical_url: string;
}

/** Chunk con embedding (formato antiguo v1, solo para migración). */
export interface ChunkV1 extends Chunk {
  embedding: number[];
}

/** Formato del archivo data/index.json (v2). */
export interface IndexFileV2 {
  version: 2;
  dims: number;
  chunks: Chunk[];
}

/** Resultado de scrapear una página. */
export interface ScrapedPage {
  url: string;
  title: string;
  meta_description: string;
  text: string;
  scraped_at: string;
  internal_links: string[];
  /** Identificador del sitio de origen (garmoth, bdo, ...). */
  site_id: SiteId;
}

/** Chunk puntuado durante la búsqueda. */
export interface ScoredChunk extends Chunk {
  score: number;
  /** Posición en el store (fila de embeddings). */
  pos: number;
  /**
   * Coseno original previo al re-ranking. Cuando el rerank (judge/MMR) sobrescribe
   * `score`, este campo conserva el coseno puro para el umbral de `lowConfidence`.
   */
  cosine?: number;
}

/** Fuente citada en la respuesta. */
export interface Source {
  url: string;
  title: string;
  date: string;
}

/** Métricas de rendimiento de una consulta. */
export interface QueryMeta {
  embedMs: number;
  searchMs: number;
  rerankMs: number;
  llmMs: number;
  totalMs: number;
  chunksScanned: number;
  candidates: number;
  rerankStrategy: string;
  cached: boolean;
}

/** Resultado de una consulta. */
export interface QueryResult {
  answer: string;
  sources: Source[];
  meta: QueryMeta;
  /** true si el sistema detectó baja confianza en la respuesta. */
  lowConfidence: boolean;
}

/** Mensaje de chat para Ollama. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type RerankStrategy = 'judge' | 'mmr' | 'none';
