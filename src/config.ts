import * as path from 'path';
import { existsSync } from 'fs';
import type { RerankStrategy } from './types';

/** Raíz del proyecto: sube desde __dirname hasta encontrar package.json.
 *  Funciona tanto en src/ (tsx) como en dist/ (node compilado). */
function findRoot(dir: string): string {
  if (existsSync(path.join(dir, 'package.json'))) return dir;
  const parent = path.dirname(dir);
  if (parent === dir) return dir;
  return findRoot(parent);
}

const ROOT = findRoot(__dirname);

/** Permite sobreescribir la ubicación de data/ (p.ej. en la app Electron empaquetada). */
const DATA_DIR_OVERRIDE = process.env.BDO_DATA_DIR;

export const config = {
  paths: {
    root: ROOT,
    dataDir: DATA_DIR_OVERRIDE ?? path.join(ROOT, 'data'),
    scrapedDir: DATA_DIR_OVERRIDE
      ? path.join(DATA_DIR_OVERRIDE, 'scraped')
      : path.join(ROOT, 'data', 'scraped'),
    profileDir: DATA_DIR_OVERRIDE
      ? path.join(DATA_DIR_OVERRIDE, 'profile')
      : path.join(ROOT, 'data', 'profile'),
    indexFile: DATA_DIR_OVERRIDE
      ? path.join(DATA_DIR_OVERRIDE, 'index.json')
      : path.join(ROOT, 'data', 'index.json'),
    embeddingsFile: DATA_DIR_OVERRIDE
      ? path.join(DATA_DIR_OVERRIDE, 'embeddings.bin')
      : path.join(ROOT, 'data', 'embeddings.bin'),
  },

  ollama: {
    baseUrl: 'http://localhost:11434',
    embedModel: 'nomic-embed-text',
    chatModel: 'llama3.1:8b',
    /** Modelo usado para puntuar relevancia de chunks (re-ranking). */
    judgeModel: 'llama3.1:8b',
    embedDims: 768,
    embedBatchSize: 32,
    requestTimeoutMs: 120_000,
  },

  chunker: {
    /** Palabras objetivo por chunk (aproximado). */
    targetWords: 400,
    /** Frases solapadas entre chunks consecutivos. */
    overlapSentences: 1,
    minChunkChars: 30,
    maxInputChars: 50_000,
  },

  retriever: {
    /** Candidatos por similitud coseno antes del re-ranking. */
    topK: 10,
    /** Chunks finales que se inyectan como contexto. */
    topFinal: 5,
    /** Score coseno mínimo para considerar un candidato. */
    minCosine: 0.25,
    /** Estrategia de re-ranking por defecto. */
    rerank: 'judge' as RerankStrategy,
    /** Lambda de MMR: 1 = solo relevancia, 0 = solo diversidad. */
    mmrLambda: 0.7,
    /** Si el mejor score coseno es menor que esto, marcar lowConfidence. */
    lowConfidenceThreshold: 0.35,
  },

  queryCache: {
    ttlMs: 10 * 60 * 1000,
    maxEntries: 256,
  },

  scraper: {
    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    cdpPort: 9222,
    delayMs: 2000,
    /** Tope de páginas por sitio. El total entre sitios puede ser sites.length × maxPages. */
    maxPages: 100,
    sites: [
      {
        id: 'garmoth',
        baseUrl: 'https://garmoth.com',
        startUrls: [
          // Portada y secciones principales
          '/',
          '/guides',
          '/news',
          '/events',
          '/coupons',
          '/changelog',
          // Índice y clases principales
          '/classes',
          '/classes/musa',
          '/classes/berserker',
          '/classes/wizard',
          '/classes/valkyrie',
          '/classes/striker',
          '/classes/corsair',
          // Guías temáticas clave
          '/guides/enhancing',
          '/guides/lifeskilling',
          '/guides/nodes',
          '/guides/horses',
          '/guides/combat',
          '/guides/sailing',
        ],
      },
      {
        id: 'bdo',
        baseUrl: 'https://www.naeu.playblackdesert.com',
        startUrls: [
          '/',
          '/News/Notice',
          '/News/Events',
          '/World',
          '/Classes',
          '/Adventure',
        ],
      },
    ],
  },
} as const;
