---
name: rag-pipeline
description: Use when modifying src/query.ts, src/retriever.ts, src/ollama.ts, system prompts, citation format, rerank strategy, or query-embedding cache.
---

# rag-pipeline

The RAG pipeline has three stages: embed (with cache) → retrieve (cosine + rerank) → answer (Ollama chat with [ref:N] citations). All user-facing text is Spanish.

## Key invariants

### Ollama client (`src/ollama.ts`)

- Two endpoints, both on `${config.ollama.baseUrl}` (default `http://localhost:11434`):
  - `POST /api/embed` — single or batch input, returns `{ embeddings: number[][] }` (`ollama.ts:42-63`). The batch form requires the response count to match the input count, otherwise throws `OllamaUnavailableError`. Single-input (`embed`) must also return a non-empty array; an empty result would later surface as a raw `TypeError` in similarity math.
  - `POST /api/chat` — `stream: true` returns NDJSON, one JSON object per line (`ollama.ts:88-165`). Non-stream returns `{ message: { content } }`. Lines that fail to parse are silently dropped (these are keep-alives). Errors emitted mid-stream (`{"error": ...}`) are surfaced as `OllamaUnavailableError` instead of being silently truncated.
- Models are hard-coded in `config.ts:39-42`:
  - `embedModel: 'nomic-embed-text'` → 768 dims
  - `chatModel: 'llama3.1:8b'`
  - `judgeModel: 'llama3.1:8b'` (same as chat)
- Default request timeout is 120 s via `AbortSignal.timeout` (`ollama.ts:24,107`). Connection errors (fetch failed / ECONNREFUSED / TimeoutError) are wrapped in `OllamaUnavailableError` with a hint to run `ollama serve`.
- `judgeRelevance` (`ollama.ts:172-225`): truncates each doc to 1500 chars, sends a system prompt instructing JSON-only output, temperature 0, `num_predict: 120`. Parses the first `{ "scores": [...] }` substring. Returns `null` on any failure so callers can fall back.

### Query pipeline (`src/query.ts`)

- `query` and `queryStream` differ only in streaming vs buffered LLM call; both call `runRetrieval` then `dedupeChunksByCanonical` then `buildPrompts` then `chat` / `chatStream` (`query.ts:24-214`).
- `buildPrompts` (`query.ts:46-65`): system prompt mandates `[ref:N]` citations after each important claim; user prompt is `INFORMACIÓN DISPONIBLE: ... PREGUNTA: ...`. La numeración de las fuentes en el prompt (`[Fuente 1..N]`) está 1:1 con las fuentes mostradas al usuario gracias al `dedupeChunksByCanonical` previo.
- `lowConfidence` (`query.ts:75-77`): `true` if the answer regex `/\[ref:\d+\]/` finds no citations, OR if `bestCosine < config.retriever.lowConfidenceThreshold` (0.35). El `bestCosine` se toma del campo `ScoredChunk.cosine` (puro, pre-rerank), no de `score` (que el judge/MMR pueden haber sustituido).
- `dedupeChunksByCanonical` (`query.ts`, exportado como `@internal`) reduce los chunks a uno por `canonical_url` (mayor score gana) **antes** de numerar las fuentes — sin esto el contrato `[ref:N]` se desincroniza con la lista mostrada al colapsar URLs.
- Temperature: 0.2 for chat, 0 for judge. `numPredict` defaults to undefined (Ollama default).

### Retrieval (`src/retriever.ts`)

- `retrieve` (`retriever.ts:20-61`): `store.scoreAll(queryEmbedding)` over the in-memory `Float32Array` view (no copies), sort desc, filter by `minCosine` (0.25), slice `topK` (10). If the candidate list is empty, return early.
- Three rerank strategies (`config.ts:65`, all implemented in `retriever.ts`):
  - `'judge'` (default): `judgeRelevance(question, candidates.map(c => c.text))`. If scores are returned, save the original cosine in `ScoredChunk.cosine` and override `score` with the judge score (0–10) before sorting. If null, fall back to cosine and label `'none (judge falló)'`.
  - `'mmr'`: `mmrLambda * candCosine - (1 - lambda) * maxSimToSelected`, `lambda = config.retriever.mmrLambda` (0.7). Greedy selection over remaining candidates. Original cosine saved in `ScoredChunk.cosine` similarly.
  - `'none'`: just `candidates.slice(0, topFinal)` (no override; cosine == score).
- Final output is always `topFinal` (5) chunks. `mmr` and `none` ignore the question text in the final step (relevance comes from the cosine that was already computed).

### Query-embedding cache (`src/store.ts:319-358`)

- Key = `question.trim().toLowerCase().replace(/\s+/g, ' ')`. TTL = 10 min, max 256 entries (LRU). LRU implemented via Map insertion-order re-insert on `get`. Cache is process-local; it resets on app restart.

## Common pitfalls

- The system prompt and the `lowConfidence` check are coupled. If you change the citation contract, update both `query.ts:54-65` and the regex in `query.ts:75`.
- `judgeRelevance` returns `null` on any failure (incl. network, parse, length mismatch). Don't try to "partially" use its result — the caller treats null as "fall back to cosine".
- `scoreAll` iterates the whole index linearly. With ~10k chunks it's still fast (Float32 SIMD-friendly), but anything past ~100k chunks will dominate query latency. Profile before adding a vector index.
- The Spanish-only contract is enforced by the system prompt. If you add English content, the LLM will still answer in Spanish unless you also change the system prompt.
- The cache key is whitespace-normalized but **not** accent-folded — `"México"` and `"Mexico"` are different keys.
