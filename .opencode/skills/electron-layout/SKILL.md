---
name: electron-layout
description: Use when modifying src/ui/, tsconfig*.json, package.json build scripts, or anything related to how the RAG gets loaded into the Electron main process.
---

# electron-layout

Three TypeScript projects compile to three separate `dist*` folders, with strict rootDir boundaries. The Electron main process loads the RAG at runtime via `require`, so build order and the existence of `dist/` are load-bearing.

## Key invariants

### Three tsconfigs, three outputs

| tsconfig | rootDir | outDir | files | module |
| --- | --- | --- | --- | --- |
| `tsconfig.json` | `src/` (excludes `src/ui`) | `dist/` | full RAG | commonjs |
| `tsconfig.ui.json` | `src/ui` | `dist-ui/` | `main.ts`, `preload.ts` | commonjs |
| `tsconfig.renderer.json` | `src/ui/renderer` | `dist-renderer/` | `renderer.ts` | `none` (script output) |

- The `exclude: ["src/ui"]` in `tsconfig.json:22` is the seam that keeps RAG and UI separate.
- The renderer tsconfig is the only one with `lib: ["ES2022", "DOM", "DOM.Iterable"]` and `module: "none"` — it produces a plain script that runs in the browser context.
- The renderer tsconfig has no `types: ["node"]`; the UI and RAG tsconfigs do. Don't add Node globals to the renderer.

### Runtime `require()` of the RAG

- `src/ui/main.ts:79-81` does:
  ```ts
  const { queryStream } = require(path.join(__dirname, '..', 'dist', 'query.js')) as RagModule;
  const { getStats } = require(path.join(__dirname, '..', 'dist', 'store.js')) as StoreModule;
  const { startScrape } = require(path.join(__dirname, '..', 'dist', 'scrape-runner.js')) as ScrapeRunnerModule;
  ```
  This is why `dist/` must exist before `electron .` runs. `npm run ui:dev` enforces order (`build` before `build:ui`); the reverse would crash at startup.
- `BDO_DATA_DIR` env var is set **before** the `require` calls in packaged mode (`src/ui/main.ts:6-8`): `if (app.isPackaged) process.env.BDO_DATA_DIR = path.join(process.resourcesPath, 'data');`. `src/config.ts:17,22-34` reads it; everything downstream (store, scraper, indexer) resolves the data dir through `config.paths`.

### DTO duplication across the three tsconfigs

- Because each tsconfig has its own rootDir, **the UI and renderer cannot import from `src/types.ts`**. `src/ui/main.ts:15-77` re-declares the DTOs it needs (`SourceDto`, `QueryMetaDto`, `QueryResultDto`, `StatsDto`, `RagModule`, `StoreModule`, `ScrapeRunnerModule`). `src/ui/preload.ts:3-35` does the same. `src/ui/renderer/renderer.ts:6-55` re-declares them a third time.
- If you change `src/types.ts`, **you must update all three declaration sites** in lockstep. The compiler won't catch a drift because the types are structurally compatible.
- A safer refactor is to put the shared DTOs in `src/ui/dtos.ts` and import them from `main.ts`, `preload.ts`, `renderer.ts` (the UI tsconfigs share `rootDir: src/ui`).

### Renderer script loading

- `marked` is loaded as a UMD `<script>` in `src/ui/renderer/index.html:76` and exposed as a global. `renderer.ts:58-60` declares it with `declare const marked: { parse(text, options?): string }` — **do not** add a `marked` import to the renderer TS, the bundler/tsconfig can't resolve it.
- `scripts/copy-renderer-assets.js` copies `index.html`, `styles.css`, and `node_modules/marked/lib/marked.umd.js` to `dist-renderer/`. This step is the third phase of `npm run build:ui` and is not optional — the renderer will fail to find `marked.parse` without `marked.umd.js` in the same directory.
- `electron-builder.yml` packages `dist-renderer/**/*` including the copied assets.

### Security defaults (`src/ui/main.ts:97-104`)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Don't relax these — the renderer is the only untrusted surface.
- `setWindowOpenHandler` denies all new windows and routes the URL to `shell.openExternal`. Don't remove this.
- The renderer's CSP is inline in `src/ui/renderer/index.html:5`: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. Inline styles are allowed because `marked` output is post-processed with `innerHTML` and some browser sanitizers reject `style=` attributes otherwise.

### IPC contract

Channels (`src/ui/main.ts:127-201`, `src/ui/preload.ts:37-67`):

- Request/reply: `question:ask`, `stats:get`, `rerank:set`, `rerank:get`, `wallpaper:get`, `scrape:start`, `scrape:cancel`.
- Push (main → renderer): `stream-token`, `stream-done`, `stream-error`, `scrape:progress`, `scrape:index-progress`, `scrape:done`, `scrape:error`.

The renderer accesses the IPC through `window.bdo` (`preload.ts:69` exposes via `contextBridge.exposeInMainWorld('bdo', api)`). The renderer TS declares this as `declare const bdo: BdoApi;` (`renderer.ts:57`).

### Build / run scripts (`package.json:6-20`)

- `npm run build` → `prebuild: clean:rag` (removes `dist/`) + `tsc`. Only cleans its own output.
- `npm run build:ui` → `prebuild:ui: clean:ui` (removes `dist-ui/`, `dist-renderer/`, `dist-installer/`) + 3 tsc invocations + asset copy.
- `npm run ui:dev` → `build` + `build:ui` + `electron .`. No pre-clean; relies on each build's pre-script.
- `npm run ui:pack` → `preui:pack: clean` (wipes all four) + the two builds + `wallpaper` + `icon` + `electron-builder --win nsis --publish never`.
- There is no `lint` or `typecheck` script. Type errors surface during `tsc` in the build. There is no hot reload — rebuild + relaunch manually.

## Common pitfalls

- Don't move `src/types.ts` (or any other RAG-side file) into `src/ui/`. The three tsconfigs are not symmetric and cross-imports break.
- Don't `import { marked } from 'marked'` in renderer TS. The renderer is `module: none`. Use the UMD via the existing `declare const marked` shim.
- Don't run `electron .` without first running `npm run build` (or `npm run ui:dev`). The main process will crash on the first `require('../dist/...')`.
- Don't expect the RAG to read packaged data by default. The `BDO_DATA_DIR` env var is the only way it knows; if you forget the `if (app.isPackaged)` block, packaged builds will read the dev data dir.
- Wallpaper resolution (`main.ts:210-222`): `BDO_WALLPAPER_PATH` env > `process.resourcesPath/wallpaper.jpg` (packaged, from `extraResources` in `electron-builder.yml:27-30`) > `~/Downloads/Wallpaper.jpg` (dev). The dev fallback is hard-coded; don't expect the wallpaper to "just work" on a fresh checkout.
- `electron-builder.yml` excludes large dev-only deps from the installer (`electron`, `electron-builder`, `sharp`, `@img`, `typescript`, `tsx`). `playwright` is intentionally included and unpacked from asar (`asarUnpack: "**/playwright/**"`, `"**/playwright-core/**"`) so the in-app **🔄 Re-scrapear** button can spawn the scraper from the installed build. Don't re-exclude playwright without also disabling the in-app scrape button.
- `playwright-extra` and `puppeteer-extra-plugin-stealth` were removed from `dependencies` — they were never imported by the source.
