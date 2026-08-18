import { config } from './config';
import { IndexEmptyError } from './errors';
import { chat, chatStream, embed } from './ollama';
import { retrieve } from './retriever';
import { queryEmbeddingCache, store } from './store';
import type { QueryMeta, QueryResult, ScoredChunk, Source } from './types';
import type { RerankStrategy } from './types';

export interface QueryOptions {
  rerank?: RerankStrategy;
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
async function runRetrieval(question: string, options: QueryOptions): Promise<RetrievalOutcome> {
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

/** Construye los prompts del sistema y usuario con el contexto numerado. */
function buildPrompts(question: string, chunks: ScoredChunk[]): { systemPrompt: string; userPrompt: string } {
  const context = chunks
    .map((c, i) => {
      const date = c.scraped_at ? c.scraped_at.split('T')[0] : 'desconocida';
      return `[Fuente ${i + 1}] URL: ${c.url} | Fecha: ${date}\n${c.text}`;
    })
    .join('\n\n');

  const systemPrompt = `Eres un asistente experto en Black Desert Online (BDO).
Responde ÚNICAMENTE basándote en la información proporcionada a continuación.
REGLAS OBLIGATORIAS:
- Cada afirmación importante debe terminar con la cita de su fuente: [ref:N] (N = número de fuente).
- Si la información no es suficiente para responder, dilo claramente en lugar de inventar.
- Menciona la fecha de los datos cuando sea relevante.
- Responde en español, de forma clara y directa.`;

  const userPrompt = `INFORMACIÓN DISPONIBLE:\n\n${context}\n\nPREGUNTA: ${question}\n\nRESPUESTA (basada solo en la información anterior, en español, con citas [ref:N]):`;

  return { systemPrompt, userPrompt };
}

/** Ensambla el QueryResult final con validación de confianza y fuentes deduplicadas. */
function finalizeResult(
  answer: string,
  chunks: ScoredChunk[],
  meta: Omit<QueryMeta, 'llmMs' | 'totalMs' | 'candidates'>,
  llmMs: number,
  totalMs: number,
): QueryResult {
  const hasCitations = /\[ref:\d+\]/.test(answer);
  const bestCosine = chunks[0]?.score ?? 0;
  const lowConfidence = !hasCitations || bestCosine < config.retriever.lowConfidenceThreshold;

  return {
    answer: answer || 'No se pudo generar una respuesta.',
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

function emptyResult(question: string, r: RetrievalOutcome, t0: number): QueryResult {
  void question;
  return {
    answer:
      'No encontré información relevante en garmoth.com para tu pregunta. ' +
      'Prueba reformularla o ejecuta /scrape para ampliar la base de datos.',
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

  if (store.isEmpty()) {
    throw new IndexEmptyError('No hay datos indexados. Ejecuta /scrape primero para obtener información de garmoth.com.');
  }

  const r = await runRetrieval(question, options);
  if (r.chunks.length === 0) return emptyResult(question, r, t0);

  const { systemPrompt, userPrompt } = buildPrompts(question, r.chunks);

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
    r.chunks,
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

  if (store.isEmpty()) {
    throw new IndexEmptyError('No hay datos indexados. Ejecuta /scrape primero para obtener información de garmoth.com.');
  }

  const r = await runRetrieval(question, options);
  if (r.chunks.length === 0) return emptyResult(question, r, t0);

  const { systemPrompt, userPrompt } = buildPrompts(question, r.chunks);

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
    r.chunks,
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
