# AGENTS.md

Local Electron app for Black Desert Online. It scrapes BDO game data from `garmoth.com` and `naeu.playblackdesert.com`, embeds it via Ollama, and answers BDO questions in Spanish through a local LLM. All user-facing strings, scraper prompts, and answers are in Spanish.

## Architecture

Three TypeScript projects compiled separately into three dist folders:

| tsconfig | rootDir | outDir | contents |
| --- | --- | --- | --- |
| `tsconfig.json` | `src/` (excludes `src/ui`) | `dist/` | RAG pipeline (CommonJS, Node) |
| `tsconfig.ui.json` | `src/ui/main.ts`, `preload.ts` | `dist-ui/` | Electron main + preload (CommonJS) |
| `tsconfig.renderer.json` | `src/ui/renderer/renderer.ts` | `dist-renderer/` | Renderer (`module: none`, DOM lib) |

`src/ui/main.ts` loads the RAG at runtime via `require('../dist/query.js')` etc., so `dist/` must exist before launching the Electron app. The `package.json` `main` field points at `dist-ui/main.js`.

The RAG pipeline: `scraper.ts` (Chrome + Playwright/CDP) writes JSON to `data/scraped/` → `indexer.ts` chunks + embeds → `data/index.json` + `data/embeddings.bin` → `query.ts` + `retriever.ts` do cosine + judge/MMR rerank over an in-memory `Float32Array` view of `embeddings.bin`. `queryStream` streams Ollama NDJSON to the renderer via IPC.

## Build & run

- `npm run build` — `tsc` for the RAG (writes `dist/`). Has `prebuild: npm run clean:rag`.
- `npm run build:ui` — three steps in order: `tsc -p tsconfig.ui.json` → `tsc -p tsconfig.renderer.json` → `node scripts/copy-renderer-assets.js` (copies `index.html`, `styles.css`, and `marked.umd.js` from `node_modules` into `dist-renderer/`). Has `prebuild:ui: npm run clean:ui`.
- `npm run ui:dev` — full RAG build + UI build + `electron .`. Use this to launch the app in dev.
- `npm run ui:pack` — `clean` → RAG build → UI build → `wallpaper` → `icon` → `electron-builder --win nsis --publish never`. Output: `dist-installer/`.
- `npm test` — `tsx --test tests/**/*.test.ts`. Only `chunker.test.ts` and `similarity.test.ts` exist; everything else (store, retriever, scraper, query) needs Ollama/Chrome and is not unit-tested.
- There is no `lint`, no formatter, no separate `typecheck`. Run `npm run build` to surface type errors via `tsc`.

## Required external services

- **Ollama** at `http://localhost:11434` with `nomic-embed-text` (768-dim embeddings) and `llama3.1:8b` (chat + judge). Models are hard-coded in `src/config.ts`. Connection failures throw `OllamaUnavailableError`.
- **Google Chrome** at `C:\Program Files\Google\Chrome\Application\chrome.exe` for the scraper. It is launched with `--remote-debugging-port=9222` and `--user-data-dir=data/profile` to bypass Cloudflare. `data/profile/` and `tmp_profile/` are auto-created Chrome profiles (gitignored).
- Both paths are Windows-specific; the app is currently Windows-only (NSIS target, hard-coded Chrome path, `taskkill` for process cleanup in `scraper.ts`/`scrape-runner.ts`).

## Data layout

- `data/scraped/<siteId>__<slug>.json` — one file per scraped page. `siteId` is the prefix (`garmoth` or `bdo`) so files from different sites don't collide.
- `data/index.json` — v2 format: `{ version: 2, dims, chunks: Chunk[] }`. Chunks have `source` (defaults to `'garmoth'`) and `canonical_url` (host lowercased, no `www.`, no utm/fbclid/gclid, no trailing slash).
- `data/embeddings.bin` — Float32 LE, 16-byte header (`magic "BDOE" + version + dims + count`) followed by `count * dims` floats. `store.ts` mmap-s this as a `Float32Array` view (no per-chunk copies).
- Packaged builds override `data/` location: `src/ui/main.ts` sets `process.env.BDO_DATA_DIR = path.join(process.resourcesPath, 'data')` before requiring the RAG. `src/config.ts` reads this env var. Override manually with `BDO_DATA_DIR=...` for testing.

## Gotchas

- **`npm run migrate` is referenced in error messages (`store.ts:50,76`, `migrate-embeddings.ts:5`) but the script is not in `package.json`.** Run it directly: `npx tsx src/migrate-embeddings.ts`. It converts legacy v1 `index.json` (embeddings inline) to the v2 split format and writes `index.json.v1.bak`.
- `indexer.ts` and `query.ts` have `if (require.main === module)` entry points but no npm scripts; invoke via `npx tsx src/indexer.ts [--reindex]` and `npx tsx src/query.ts "¿...?"`.
- The scraper runs as a child process via `src/scrape-runner.ts`. Spawn uses `process.execPath` (Electron binary) with `ELECTRON_RUN_AS_NODE: '1'` in the child env (`scrape-runner.ts:42`) so the child runs as plain Node, not as a second Electron instance. Expects `dist/scraper.js` to exist (i.e. `npm run build` first). On Windows, cancellation falls back from `SIGTERM` to `taskkill /T /F`.
- `src/ui/main.ts` re-declares minimal DTOs locally because the renderer/main cannot import from `src/` (rootDir boundaries). Don't move them to a shared `src/types.ts` without fixing the rootDirs.
- The renderer UMD `marked` library is loaded as a `<script>` in `src/ui/renderer/index.html` (copied by `scripts/copy-renderer-assets.js`); don't try to import it from the renderer TS.
- The chat/judge model is the same (`llama3.1:8b`). Changing one in `config.ts` is not enough if you also want to change the other.
- `package.json` has `"type": "commonjs"`, so all TS compiles to CommonJS except the renderer (which sets `"module": "none"`).
- `npm run clean` wipes all four dist dirs at once; each build's pre-script only cleans its own half.
