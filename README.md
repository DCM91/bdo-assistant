# BDO Assistant

> A local-first RAG chatbot for Black Desert Online, powered by Ollama.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078d4.svg)
![Node: 22+](https://img.shields.io/badge/node-22%2B-339933.svg)
![Electron 43](https://img.shields.io/badge/electron-43-47848F.svg)

## Why

Black Desert Online's best community knowledge lives scattered across English,
Korean and Spanish-speaking sites (garmoth.com, naeu.playblackdesert.com).
BDO Assistant scrapes that content locally, embeds it with a local model, and
answers your questions in natural language — **in your language** — entirely
on your machine.

No data leaves your computer. No accounts. No telemetry. No cloud.

## Features

- **Local scraping** of garmoth.com + naeu.playblackdesert.com via Chrome + Playwright
- **Local embeddings** via Ollama (`nomic-embed-text`, 768-dim)
- **Local LLM** via Ollama (`llama3.1:8b`) with streaming responses
- **Source citations** `[ref:N]` linking every claim back to the source page
- **Trilingual UI** — English / Español / Português (LLM prompts localized too)
- **Atomic index store** — writes via tmp + rename, never corrupts on crash
- **Three rerank strategies** — LLM judge, MMR diversity, or none
- **Indexed pages inventory** — list, search, delete, export CSV
- **Cancel anytime, single-instance lock**
- **Windows-first** packaging via NSIS installer

## Architecture

```
   ┌──────────────┐    ┌─────────────┐    ┌────────────────────┐
   │  Web scraper │ →  │  Chunked    │ →  │  data/index.json   │
   │  (Playwright)│    │  text +     │    │  data/embeddings.bin│
   │              │    │  Ollama     │    └────────────────────┘
   └──────────────┘    │  embed      │              ↓
        ↑              └─────────────┘    ┌────────────────────┐
        │ scrape        ↓                 │  User question     │
   Chrome─CDP         chunks              │  embed → cosine    │
                                          │  → rerank          │
                                          │  → LLM (stream)    │
                                          │  with [ref:N] cites│
                                          └────────────────────┘
```

Everything runs locally. Ollama serves `nomic-embed-text` for embeddings and
`llama3.1:8b` for both chat and relevance reranking. The Electron frontend
streams tokens to the user as the LLM generates them.

## Requirements

- Node.js 22+
- [Ollama](https://ollama.com) running locally with the bundled models:
  ```bash
  ollama pull nomic-embed-text
  ollama pull llama3.1:8b
  ```
- Google Chrome installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`
  (default on Windows; configurable via `config.scraper.chromePath`)

## Quick start

```bash
git clone https://github.com/DCM91/bdo-assistant
cd bdo-assistant
npm install
npm run ui:dev          # builds RAG + UI + launches Electron
```

In the app, click **🔄 Re-scrape** to populate the index. The first run takes
a few minutes; subsequent scrapes only index new pages.

## Build & run

| Command | What it does |
|---|---|
| `npm run build` | Compile the RAG pipeline (`dist/`) |
| `npm run build:ui` | Compile the Electron main + preload + renderer (`dist-ui/`, `dist-renderer/`) |
| `npm run ui:dev` | Full build + launch the app |
| `npm run ui:pack` | Build the Windows NSIS installer (`dist-installer/`) |
| `npm run index` | Re-run the indexer (adds new pages) |
| `npm run index -- --reindex` | Clear and rebuild the index from scratch |
| `npm run ask "¿...?"` | Query from the CLI |
| `npm run migrate` | Migrate a legacy v1 index to v2 |
| `npm test` | Run the test suite (chunking, similarity, parseScores, dedupe, i18n, store) |

## Project structure

```
src/
├── config.ts          # paths, models, chunker params
├── chunker.ts         # text → sentence-aware chunks
├── store.ts           # in-memory Float32Array + atomic on-disk index
├── indexer.ts         # scraped JSON → chunks + embeddings
├── query.ts           # RAG pipeline (embed + retrieve + chat)
├── retriever.ts       # cosine + LLM/MMR rerank
├── ollama.ts          # Ollama HTTP client
├── i18n/locales.ts    # LLM prompt translations (shared with renderer)
├── scraper.ts         # Playwright + Chrome CDP
├── scrape-runner.ts   # spawn scraper as child process
└── ui/
    ├── main.ts        # Electron main + IPC
    ├── preload.ts     # contextBridge API
    └── renderer/      # HTML/CSS + renderer.ts (UI + i18n)
scripts/
├── copy-renderer-assets.js
├── copy-wallpaper.js
└── generate-icon.js
```

## Contributing

Pull requests are welcome.

1. Fork the repository
2. Create a branch from `main` (`git checkout -b feat/my-thing`)
3. Make your changes
4. Run `npm test` and `npm run build` and make sure both pass
5. Open a PR against `main`

> **Note:** the project maintainer reviews and merges PRs on `main`. Direct
> pushes to `main` are not accepted.

### i18n

If you add or modify a UI string, update both:

- `src/ui/renderer/renderer.ts` — the `TR` constant (used by the renderer)
- `src/i18n/locales.ts` — the `TRANSLATIONS` object (used by the RAG for LLM prompts)

Keys should be in `dot.case` and identical across the three locales.

## Legal

Unofficial fan project. Not affiliated with, endorsed by, or sponsored by Pearl Abyss, Kakao Games, or garmoth.com. All scraped content is the property of its respective owners.

## License

[MIT](LICENSE) © 2026 [DCM91](https://github.com/DCM91)
