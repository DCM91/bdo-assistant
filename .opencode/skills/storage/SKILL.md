---
name: storage
description: Use when modifying src/store.ts, src/indexer.ts, src/migrate-embeddings.ts, or the on-disk format of data/index.json and data/embeddings.bin.
---

# storage

v2 storage format: `data/index.json` (metadata only) + `data/embeddings.bin` (Float32 binary, mmap'd as a `Float32Array` view). v1 had embeddings inline in JSON; the migration is one-shot and runs out-of-band.

## Key invariants

### v2 file format

- `data/index.json`: `{ version: 2, dims: number, chunks: Chunk[] }` (`types.ts:27-31`). No embeddings here.
- `data/embeddings.bin` layout (16-byte header + body, all little-endian):
  - `bytes 0-3` — magic `0x454f4442` = `"BDOE"` LE (`store.ts:18`, `migrate-embeddings.ts:11`).
  - `bytes 4-7` — uint32 LE version, currently `1`.
  - `bytes 8-11` — uint32 LE dims (must match `index.json: dims`).
  - `bytes 12-15` — uint32 LE count (must match `index.json: chunks.length`).
  - `bytes 16+` — `count * dims` Float32 LE values, row-major (chunk `i` occupies floats `[i*dims, (i+1)*dims)`).
- `store.ts:80-111` loads by `openSync` + `readSync` into a `Buffer`, then constructs `new Float32Array(buffer.buffer, buffer.byteOffset + HEADER_BYTES, count * dims)`. **Zero-copy view** — the buffer is held until reload.

### Error semantics (`src/errors.ts`)

- `IndexEmptyError` — store has zero chunks. Thrown by `store.scoreAll` and by `query.ts:131,177`.
- `MigrationRequiredError` — `data/index.json` is a plain array (v1 shape). Thrown by `store.ts:48-52`.
- `StoreCorruptedError` — bad magic, dims/count mismatch, file size wrong, embedding dim mismatch on append. Thrown from `store.ts:62-103,188,213`.

### Mutation semantics (`src/store.ts`)

- `appendChunks(chunks, embeddings)` (`store.ts:186-231`) **rewrites the entire `embeddings.bin`** (and the entire `index.json`). O(total chunks) writes but binary-pure, ~100 MB/s. Fine for typical web-scrape volumes; would be a bottleneck past ~1M chunks.
- `replaceAll(chunks, embeddings)` (`store.ts:234-242`) — used by `--reindex`. Truncates both files to empty, then calls `appendChunks` with the freshly-embedded set.
- After `appendChunks` the in-memory cache is invalidated (`this.loaded = false`); callers must `store.reload()` before reading (`indexer.ts:117,126` does this).

### Indexer (`src/indexer.ts`)

- `indexAll(reindex)` reads every `*.json` in `config.paths.scrapedDir`, skips files where:
  - `page.url` or `canonicalUrl(page.url)` is already in the index (incremental skip, `indexer.ts:75`),
  - `page.text.length < 50` (`indexer.ts:79`),
  - chunking produces 0 chunks (`indexer.ts:85`).
- Chunks are embedded in batches of `config.ollama.embedBatchSize` (32). On a failed batch, partial results are persisted and the loop breaks (`indexer.ts:112-122`).
- New chunks default to `source: 'garmoth'` for backward compat with pre-multi-site files (`indexer.ts:145`).
- `canonical_url` is set at index time from `canonicalUrl(page.url)`, not re-derived later.

### v1 → v2 migration (`src/migrate-embeddings.ts`)

- Invoked as `npx tsx src/migrate-embeddings.ts`. **Not `npm run migrate`** — that script does not exist in `package.json` despite what the error messages in `store.ts:50,76` and `migrate-embeddings.ts:5` say.
- Writes `data/index.json.v1.bak` as a backup.
- New chunks in the migrated index all get `source: 'garmoth'` (hard-coded in the migration, `migrate-embeddings.ts:64`).

### `canonicalUrl` duplication

- `canonicalUrl` lives in `scraper.ts:38-52` and is duplicated as `canonicalUrlLocal` in `store.ts:261-275`. They are byte-equivalent. The duplication exists so the store module doesn't pull in playwright/cheerio through the scraper import. **If you change one, change the other.**

## Common pitfalls

- Don't import from `scraper.ts` in `store.ts`, `indexer.ts`, or `query.ts`. The RAG side is meant to be runnable without playwright. The price is the duplicated `canonicalUrl` helper.
- After `appendChunks`, **always** call `store.reload()` (or set `loaded = false`) before reading. The `Float32Array` view points into the old Buffer.
- The header check `buffer.readUInt32LE(0) !== MAGIC` (`store.ts:86`) is endianness-sensitive. Magic is `0x454f4442` because that's `"BDOE"` in LE. Don't reorder the bytes.
- `indexer.ts:75` skips by either literal URL or canonical URL. If a site is re-scraped under a new URL that canonicalizes to an existing one, it is correctly skipped — but if the URL is genuinely new and the canonical is new, both will be indexed (possible duplicate content). Check via `getStats` if unsure.
- `replaceAll` is the only path that produces an index.json with no chunks. After `replaceAll([])`, the file is `{ version: 2, dims, chunks: [] }`, not deleted — `store.load` handles both.
