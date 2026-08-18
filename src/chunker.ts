import { config } from './config';

/**
 * Divide un texto en frases. Heurística robusta:
 * - Primero parte por saltos de línea / párrafo (lo que mantiene la estructura semántica).
 * - Dentro de cada bloque, parte por `. ! ?` seguidos de espacios.
 * - Colapsa espacios múltiples DENTRO de cada frase (no entre frases).
 *
 * Esto evita el bug previo donde textos sin puntuación (listas, tablas, JSON-like) se
 * convertían en un único "sentence" gigante.
 */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sentences: string[] = [];
  // Partir por saltos de línea / cambio de párrafo antes de colapsar espacios.
  for (const paragraph of trimmed.split(/\r?\n+/)) {
    const collapsed = paragraph.replace(/\s+/g, ' ').trim();
    if (!collapsed) continue;
    const matches = collapsed.match(/[^.!?]+(?:[.!?]+["'»)\]]*\s*|$)/g);
    if (!matches) {
      sentences.push(collapsed);
      continue;
    }
    for (const m of matches) {
      const s = m.trim();
      if (s.length > 0) sentences.push(s);
    }
  }
  return sentences;
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export interface ChunkOptions {
  targetWords?: number;
  overlapSentences?: number;
  minChunkChars?: number;
  /** Tamaño máximo (en caracteres) de un chunk; evita inyectar bloques que excedan el contexto del modelo. */
  maxChunkChars?: number;
}

/**
 * Trocea un texto en chunks respetando límites de frase.
 * Agrupa frases hasta ~targetWords palabras y solapa `overlapSentences`
 * frases entre chunks consecutivos para mantener contexto.
 *
 * Si el texto resultante supera `maxChunkChars`, se subdivide por caracteres
 * (sin re-llamar a `splitSentences`), lo que protege al embedder de páginas
 * con una sola frase gigante.
 */
export function chunkBySentences(text: string, options: ChunkOptions = {}): string[] {
  const targetWords = options.targetWords ?? config.chunker.targetWords;
  const overlap = options.overlapSentences ?? config.chunker.overlapSentences;
  const minChars = options.minChunkChars ?? config.chunker.minChunkChars;
  const maxChunkChars = options.maxChunkChars ?? 2000;

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  const hardSplit = (s: string): void => {
    for (let i = 0; i < s.length; i += maxChunkChars) {
      const piece = s.substring(i, i + maxChunkChars);
      if (piece.length >= minChars) chunks.push(piece);
    }
  };

  const flush = (): void => {
    if (current.length === 0) return;
    const text = current.join(' ');
    if (text.length >= minChars) {
      if (text.length > maxChunkChars) hardSplit(text);
      else chunks.push(text);
    }
    current = current.slice(Math.max(0, current.length - overlap));
    currentWords = wordCount(current.join(' '));
  };

  for (const sentence of sentences) {
    // Si una frase suelta excede por sí sola el tope, la subdividimos y
    // la añadimos como chunks independientes.
    if (sentence.length > maxChunkChars) {
      flush();
      hardSplit(sentence);
      continue;
    }
    const words = wordCount(sentence);
    if (currentWords > 0 && currentWords + words > targetWords) {
      flush();
    }
    current.push(sentence);
    currentWords += words;
  }
  // Último chunk (sin solape adicional)
  if (current.length > 0) {
    const text = current.join(' ');
    if (text.length >= minChars) {
      if (text.length > maxChunkChars) hardSplit(text);
      else chunks.push(text);
    }
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
