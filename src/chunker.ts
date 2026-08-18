import { config } from './config';

/**
 * Divide un texto en frases. Heurística sencilla: corta tras . ! ?
 * (también con comillas/cierres justo después) y en saltos de línea dobles.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^.!?]+(?:[.!?]+["'»)\]]*\s*|$)/g);
  if (!matches) return [normalized];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export interface ChunkOptions {
  targetWords?: number;
  overlapSentences?: number;
  minChunkChars?: number;
}

/**
 * Trocea un texto en chunks respetando límites de frase.
 * Agrupa frases hasta ~targetWords palabras y solapa `overlapSentences`
 * frases entre chunks consecutivos para mantener contexto.
 */
export function chunkBySentences(text: string, options: ChunkOptions = {}): string[] {
  const targetWords = options.targetWords ?? config.chunker.targetWords;
  const overlap = options.overlapSentences ?? config.chunker.overlapSentences;
  const minChars = options.minChunkChars ?? config.chunker.minChunkChars;

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length === 0) return;
    const chunk = current.join(' ');
    if (chunk.length >= minChars) chunks.push(chunk);
    // Solapa las últimas `overlap` frases en el siguiente chunk
    current = current.slice(Math.max(0, current.length - overlap));
    currentWords = wordCount(current.join(' '));
  };

  for (const sentence of sentences) {
    const words = wordCount(sentence);
    // Frase suelta más larga que el objetivo: va como chunk propio (no se parte)
    if (currentWords > 0 && currentWords + words > targetWords) {
      flush();
    }
    current.push(sentence);
    currentWords += words;
  }
  // Último chunk (sin solape adicional)
  if (current.length > 0) {
    const chunk = current.join(' ');
    if (chunk.length >= minChars) chunks.push(chunk);
  }

  return chunks;
}

/** Slug seguro para nombres de archivo a partir de una URL. */
export function slugify(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9\-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 80);
}
