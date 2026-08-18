import { config } from './config';
import { IndexEmptyError } from './errors';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  type Locale,
} from './i18n/locales';
import { chat, chatStream, embed } from './ollama';
import { retrieve } from './retriever';
import { queryEmbeddingCache, store } from './store';
import type { QueryMeta, QueryResult, ScoredChunk, Source } from './types';
import type { RerankStrategy } from './types';

export interface QueryOptions {
  rerank?: RerankStrategy;
  locale?: string;
}

function resolveLocale(value: string | undefined): Locale {
  if (value && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return DEFAULT_LOCALE;
}

function tFor(locale: Locale, key: string): string {
  return TRANSLATIONS[locale][key] ?? TRANSLATIONS[DEFAULT_LOCALE][key] ?? key;
}

interface RetrievalOutcome {
  questionEmbedding: number[];
  embedMs: number;
  cached: boolean;
  chunks: ScoredChunk[];
  rerankMs: number;
  searchMs: number;
  strategyUsed: string;
}

/** Etapas 1-2 del pipeline: embedding (con caché) + recuperación + re-ranking. */
async function runRetrieval(
  question: string,
  options: QueryOptions,
): Promise<RetrievalOutcome> {
  const tEmbed0 = Date.now();
  let questionEmbedding = queryEmbeddingCache.get(question);
  const cached = questionEmbedding !== null;
  if (!questionEmbedding) {
    questionEmbedding = await embed(question);
    queryEmbeddingCache.set(question, questionEmbedding);
  }
  const embedMs = Date.now() - tEmbed0;

  const tSearch0 = Date.now();
  const { chunks, rerankMs, strategyUsed } = await retrieve(
    question,
    questionEmbedding,
    options.rerank ?? config.retriever.rerank,
  );
  const searchMs = Date.now() - tSearch0 - rerankMs;

  return { questionEmbedding, embedMs, cached, chunks, rerankMs, searchMs, strategyUsed };
}

/** Construye los prompts del sistema y usuario con el contexto numerado y el idioma activo. */
function buildPrompts(
  question: string,
  chunks: ScoredChunk[],
  locale: Locale,
): { systemPrompt: string; userPrompt: string } {
  const context = chunks
    .map((c, i) => {
      const date = c.scraped_at ? c.scraped_at.split('T')[0] : 'desconocida';
      return `[Fuente ${i + 1}] URL: ${c.url} | Fecha: ${date}\n${c.text}`;
    })
    .join('\n\n');

  const systemPrompt = tFor(locale, 'query.systemPrompt');

  const userPrompt =
    `${tFor(locale, 'query.userPromptBefore')}\n\n${context}\n\n` +
    `${tFor(locale, 'query.userPromptQuestion')} ${question}\n\n` +
    `${tFor(locale, 'query.userPromptAfter')}`;

  return { systemPrompt, userPrompt };
}

/** Ensambla el QueryResult final con validación de confianza y fuentes deduplicadas. */
function finalizeResult(
  answer: string,
  chunks: ScoredChunk[],
  meta: Omit<QueryMeta, 'llmMs' | 'totalMs' | 'candidates'>,
  llmMs: number,
  totalMs: number,
  locale: Locale,
): QueryResult {
  const hasCitations = /\[ref:\d+\]/.test(answer);
  const bestCosine = chunks[0]?.cosine ?? chunks[0]?.score ?? 0;
  const lowConfidence = !hasCitations || bestCosine < config.retriever.lowConfidenceThreshold;

  return {
    answer: answer || tFor(locale, 'query.fallbackAnswer'),
    sources: dedupeSources(
      chunks.map((c) => ({
        url: c.url,
        title: c.title || c.url,
        date: c.scraped_at || '',
      })),
    ),
    meta: {
      ...meta,
      llmMs,
      totalMs,
      candidates: chunks.length,
    },
    lowConfidence,
  };
}

function emptyResult(question: string, r: RetrievalOutcome, t0: number, locale: Locale): QueryResult {
  void question;
  return {
    answer: tFor(locale, 'query.emptyResult'),
    sources: [],
    meta: {
      embedMs: r.embedMs,
      searchMs: r.searchMs,
      rerankMs: r.rerankMs,
      llmMs: 0,
      totalMs: Date.now() - t0,
      chunksScanned: store.count,
      candidates: 0,
      rerankStrategy: r.strategyUsed,
      cached: r.cached,
    },
    lowConfidence: true,
  };
}

/**
 * Pipeline RAG completo (sin streaming):
 * 1. Embedding de la pregunta (con caché TTL/LRU).
 * 2. Recuperación top-K por coseno + re-ranking.
 * 3. Prompt con contexto numerado y citas obligatorias [ref:N].
 * 4. Validación de confianza de la respuesta.
 */
export async function query(question: string, options: QueryOptions = {}): Promise<QueryResult> {
  const t0 = Date.now();
  const locale = resolveLocale(options.locale);

  if (store.isEmpty()) {
    throw new IndexEmptyError(
      locale === 'es'
        ? 'No hay datos indexados. Ejecuta /scrape primero.'
        : locale === 'pt'
          ? 'Não há dados indexados. Execute /scrape primeiro.'
          : 'No indexed data. Run /scrape first.',
    );
  }

  const r = await runRetrieval(question, options);
  if (r.chunks.length === 0) return emptyResult(question, r, t0, locale);

  // Deduplicamos por canonical_url antes de numerar las fuentes en el prompt,
  // para que `[ref:N]` apunte a la misma URL que se mostrará después.
  const chunks = dedupeChunksByCanonical(r.chunks);
  const { systemPrompt, userPrompt } = buildPrompts(question, chunks, locale);

  const tLlm0 = Date.now();
  const answer = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.2 },
  );
  const llmMs = Date.now() - tLlm0;

  return finalizeResult(
    answer,
    chunks,
    {
      embedMs: r.embedMs,
      searchMs: r.searchMs,
      rerankMs: r.rerankMs,
      chunksScanned: store.count,
      rerankStrategy: r.strategyUsed,
      cached: r.cached,
    },
    llmMs,
    Date.now() - t0,
    locale,
  );
}

/**
 * Igual que query() pero con streaming: onToken recibe cada fragmento
 * de la respuesta del LLM a medida que se genera.
 */
export async function queryStream(
  question: string,
  onToken: (token: string) => void,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const t0 = Date.now();
  const locale = resolveLocale(options.locale);

  if (store.isEmpty()) {
    throw new IndexEmptyError(
      locale === 'es'
        ? 'No hay datos indexados. Ejecuta /scrape primero.'
        : locale === 'pt'
          ? 'Não há dados indexados. Execute /scrape primeiro.'
          : 'No indexed data. Run /scrape first.',
    );
  }

  const r = await runRetrieval(question, options);
  if (r.chunks.length === 0) return emptyResult(question, r, t0, locale);

  // Mismo dedup por canonical_url que en query(): si dos chunks comparten URL,
  // el LLM no debe citarlos con dos `[ref:N]` distintos.
  const chunks = dedupeChunksByCanonical(r.chunks);
  const { systemPrompt, userPrompt } = buildPrompts(question, chunks, locale);

  const tLlm0 = Date.now();
  let accumulated = '';
  await chatStream(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    (token) => {
      accumulated += token;
      onToken(token);
    },
    { temperature: 0.2 },
  );
  const llmMs = Date.now() - tLlm0;

  return finalizeResult(
    accumulated,
    chunks,
    {
      embedMs: r.embedMs,
      searchMs: r.searchMs,
      rerankMs: r.rerankMs,
      chunksScanned: store.count,
      rerankStrategy: r.strategyUsed,
      cached: r.cached,
    },
    llmMs,
    Date.now() - t0,
    locale,
  );
}

/** Elimina fuentes duplicadas por URL, manteniendo el orden de relevancia. */
function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

/**
 * Reduce los chunks para que cada `canonical_url` aparezca una sola vez, quedándose
 * con el de mayor score (más relevante). Mantiene el orden original del input.
 * Fundamental para que las citas `[ref:N]` del prompt apunten a las mismas
 * URLs que después se mostrarán en la UI.
 *
 * @internal — exportada para tests.
 */
export function dedupeChunksByCanonical(chunks: ScoredChunk[]): ScoredChunk[] {
  const bestByCanonical = new Map<string, ScoredChunk>();
  for (const c of chunks) {
    const key = c.canonical_url || c.url;
    const prev = bestByCanonical.get(key);
    if (!prev || c.score > prev.score) bestByCanonical.set(key, c);
  }
  return chunks.filter((c) => bestByCanonical.get(c.canonical_url || c.url) === c);
}

if (require.main === module) {
  const q = process.argv[2] || '¿Cuáles son las mejores clases para PvE?';
  query(q)
    .then((r) => {
      console.log('\n📝 Respuesta:\n');
      console.log(r.answer);
      if (r.lowConfidence) {
        console.log('\n⚠ Confianza baja: la respuesta puede no estar bien fundamentada.');
      }
      console.log('\n📅 Fuentes:');
      r.sources.forEach((s) => {
        console.log(`  • ${s.title} (${s.date ? s.date.split('T')[0] : 'sin fecha'})`);
      });
      console.log('\n⏱  Meta:', JSON.stringify(r.meta));
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
