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
- `npm run migrate` — `tsx src/migrate-embeddings.ts` (migrates legacy v1 `index.json` to v2 split format).
- `npm run index` — `tsx src/indexer.ts [--reindex]`.
- `npm run ask` — `tsx src/query.ts "¿...?"`.
- `npm test` — `tsx --test tests/**/*.test.ts`. Cubre chunker, similarity, parseScores, dedupeChunksByCanonical, queryEmbeddingCache. Store/retriever/scraper de extremo a extremo necesitan Ollama/Chrome.
- There is no `lint`, no formatter, no separate `typecheck`. Run `npm run build` to surface type errors via `tsc`.

## Required external services

- **Ollama** at `http://localhost:11434` with `nomic-embed-text` (768-dim embeddings) and `llama3.1:8b` (chat + judge). Models are hard-coded in `src/config.ts`. Connection failures throw `OllamaUnavailableError`.
- **Google Chrome** at `C:\Program Files\Google\Chrome\Application\chrome.exe` for the scraper. It is launched with `--remote-debugging-port=9222` and `--user-data-dir=data/profile` to bypass Cloudflare. `data/profile/` and `tmp_profile/` are auto-created Chrome profiles (gitignored).
- Both paths are Windows-specific; the app is currently Windows-only (NSIS target, hard-coded Chrome path, `taskkill` for process cleanup in `scraper.ts`/`scrape-runner.ts`).

## Data layout

- `data/scraped/<siteId>__<slug>.json` — one file per scraped page. `siteId` is the prefix (`garmoth` or `bdo`) so files from different sites don't collide. Writes son **atómicas** vía `*.tmp` + `renameSync` para que un cancel/ crash no deje archivos truncados.
- `data/index.json` — v2 format: `{ version: 2, dims, chunks: Chunk[] }`. Chunks have `source` (defaults to `'garmoth'`) and `canonical_url` (host lowercased, no `www.`, no utm/fbclid/gclid, no trailing slash). `data/index.json.tmp` se usa durante las escrituras.
- `data/embeddings.bin` — Float32 LE, 16-byte header (`magic "BDOE" + bin_version + dims + count`) seguido de `count * dims` floats. `store.ts` valida magic + versión + dims + count + tamaño exacto; cualquier mismatch lanza `StoreCorruptedError`. El archivo `.tmp` se usa durante `appendChunks`/`replaceAll` (escritura atómica: el archivo viejo permanece hasta el `renameSync` final).
- En la app empaquetada, `data/` vive en `app.getPath('userData')/data` y se siembra en el primer arranque desde `resourcesPath/data` (solo `index.json` + `embeddings.bin`). Esto evita perder el re-scraping al actualizar el instalador. Override manual con `BDO_DATA_DIR=...` para testing.

## Gotchas

- `indexer.ts` y `query.ts` también están disponibles como scripts npm: `npm run index [-- --reindex]` y `npm run ask "¿...?"`. Los entry-points `if (require.main === module)` siguen funcionando.
- The scraper runs as a child process via `src/scrape-runner.ts`. Spawn uses `process.execPath` (Electron binary) with `ELECTRON_RUN_AS_NODE: '1'` in the child env (`scrape-runner.ts:42`) so the child runs as plain Node, not as a second Electron instance. Expects `dist/scraper.js` to exist (i.e. `npm run build` first). On Windows, cancellation falls back from `SIGTERM` to `taskkill /pid ${pid} /T /F` (solo sobre el PID del Chrome que nosotros mismos hemos lanzado — **nunca** `taskkill /IM chrome.exe`, que cierra el navegador del usuario).
- `src/ui/main.ts` re-declares minimal DTOs locally because the renderer/main cannot import from `src/` (rootDir boundaries). Don't move them to a shared `src/types.ts` without fixing the rootDirs.
- The renderer UMD `marked` library is loaded as a `<script>` in `src/ui/renderer/index.html` (copied by `scripts/copy-renderer-assets.js`); don't try to import it from the renderer TS. `tsconfig.renderer.json` tiene `"types": []` para impedir que globals de Node (`process`, `require`, `Buffer`) cuelen al renderer via `@types/node`.
- The chat/judge model is the same (`llama3.1:8b`). Changing one in `config.ts` is not enough if you also want to change the other.
- `package.json` has `"type": "commonjs"`, so all TS compiles to CommonJS except the renderer (which sets `"module": "none"`).
- `npm run clean` wipes all four dist dirs at once; each build's pre-script only cleans its own half.
- El electron-builder **`extraResources`** se filtra por allowlist `["index.json", "embeddings.bin"]`: el perfil de Chrome con cookies/sesión NUNCA llega al instalador. Los datos mutables viven en `userData` y se siembran desde `resourcesPath` la primera vez.

## i18n

Soporta `es` / `en` / `pt`. El idioma activo vive en `localStorage` (renderer), se selecciona con el `<select id="locale-select">` del header, y se envía a la RAG en cada `bdo.ask(question, { locale })`.

- `src/i18n/locales.ts` — fuente canónica de los prompts del LLM (`query.systemPrompt`, `query.userPromptBefore/Question/After`, `query.emptyResult`, `query.fallbackAnswer`). El RAG (`src/query.ts`) importa de aquí.
- `src/ui/renderer/renderer.ts` — tiene un objeto `TR` con todas las cadenas (UI + prompts) para los 3 idiomas. Esta copia es **intencionadamente duplicada** porque `tsconfig.renderer.json` usa `module: none` y los rootDirs no permiten importar desde `src/`. Si modificas una clave en `TR`, sincroniza también `src/i18n/locales.ts`.

Texto por línea del scraper (`scrape-runner.ts` y `scraper.ts`) sigue en español — son logs de diagnóstico para el desarrollador, no superficie traducida.

## Pages modal

Modal nuevo (botón `🔗 Páginas` en el header) que lista todas las URLs indexadas:

- `store.getIndexedPages()` agrega los chunks por URL (cuenta + fuente + fecha más reciente).
- `store.removeByUrl(url)` borra los chunks de esa URL vía `writeIndex` (atómico).
- IPC `pages:list`, `pages:delete`, `pages:export` (CSV).
- Renderer: tabla con búsqueda por título/URL, eliminación con confirmación, exportación CSV (descarga con `<a download>`).

## Governance & legal

El proyecto sigue un modelo **BDFL** (DCM91), MIT, sin ánimo de lucro. Documentos vinculantes:

- `README.md` — punto de entrada público, build, comandos, disclaimer.
- `LICENSE` — MIT.
- `GOVERNANCE.md` — quién decide qué, cómo añadir co-maintainers, forking si el BDFL desaparece.
- `CONTRIBUTING.md` — qué contribuciones se aceptan y cuáles no.
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1.
- `SECURITY.md` — cómo reportar vulnerabilidades.
- `.github/ISSUE_TEMPLATE/` + `.github/PULL_REQUEST_TEMPLATE.md` — canalizan lo que llega a GitHub.

**Política de "sin redistribución de datos scrapeados"**: el instalador **no envía** `index.json` ni `embeddings.bin` (eliminado de `extraResources` en `electron-builder.yml`). El usuario genera su propio índice en el primer scrape. Esto evita redistribuir contenido derivado de garmoth.com / Pearl Abyss en el binario que distribuimos. `src/ui/main.ts` se limita a crear `userData/data` vacío.
