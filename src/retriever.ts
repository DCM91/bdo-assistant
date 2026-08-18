import { config } from './config';
import { judgeRelevance } from './ollama';
import { cosineSimilarity } from './similarity';
import { store } from './store';
import type { RerankStrategy, ScoredChunk } from './types';

export interface RetrieveResult {
  chunks: ScoredChunk[];
  rerankMs: number;
  strategyUsed: string;
}

/**
 * Recupera los chunks más relevantes para una pregunta:
 * 1. Similitud coseno contra todo el índice (en memoria, O(n) sobre Float32Array).
 * 2. Top-K candidatos por encima del umbral.
 * 3. Re-ranking según estrategia: 'judge' (LLM), 'mmr' (diversidad) o 'none'.
 * 4. Devuelve topFinal chunks.
 */
export async function retrieve(
  question: string,
  queryEmbedding: number[],
  strategy: RerankStrategy = config.retriever.rerank,
): Promise<RetrieveResult> {
  const { topK, topFinal, minCosine } = config.retriever;

  const scored = store.scoreAll(queryEmbedding);
  scored.sort((a, b) => b.score - a.score);

  const candidates = scored.filter((c) => c.score >= minCosine).slice(0, topK);
  if (candidates.length === 0) {
    return { chunks: [], rerankMs: 0, strategyUsed: strategy };
  }

  const t0 = Date.now();
  let reranked: ScoredChunk[];
  let strategyUsed: string = strategy;

  if (strategy === 'judge') {
    const scores = await judgeRelevance(
      question,
      candidates.map((c) => c.text),
    );
    if (scores) {
      reranked = candidates
        .map((c, i) => ({ ...c, score: scores[i] }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topFinal);
    } else {
      // Fallback: el judge falló → orden por coseno
      reranked = candidates.slice(0, topFinal);
      strategyUsed = 'none (judge falló)';
    }
  } else if (strategy === 'mmr') {
    reranked = mmr(candidates, queryEmbedding, topFinal);
  } else {
    reranked = candidates.slice(0, topFinal);
  }

  return { chunks: reranked, rerankMs: Date.now() - t0, strategyUsed };
}

/**
 * Maximal Marginal Relevance: equilibra relevancia (coseno con la query)
 * y diversidad (penaliza chunks muy similares a los ya seleccionados).
 */
function mmr(candidates: ScoredChunk[], queryEmbedding: number[], k: number): ScoredChunk[] {
  const lambda = config.retriever.mmrLambda;
  const selected: ScoredChunk[] = [];
  const remaining = [...candidates];

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let maxSimToSelected = 0;
      const candEmb = store.getEmbedding(cand.pos);
      for (const sel of selected) {
        const sim = cosineSimilarity(candEmb, store.getEmbedding(sel.pos));
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }
      const mmrScore = lambda * cand.score - (1 - lambda) * maxSimToSelected;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  void queryEmbedding; // la relevancia ya viene en cand.score
  return selected;
}
