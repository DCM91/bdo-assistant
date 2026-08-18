---
name: scraper
description: Use when modifying src/scraper.ts, src/scrape-runner.ts, or config.scraper.sites, or when debugging Cloudflare / Playwright / Chrome behavior.
---

# scraper

Two-step pipeline: `src/scraper.ts` runs the actual browser work, `src/scrape-runner.ts` spawns it as a child process from the Electron main thread.

## Key invariants

- Chrome is launched by `scraper.ts:71-93` as a **detached** child with `--remote-debugging-port=9222` and `--user-data-dir=config.paths.profileDir` (default `data/profile/`). Connection via `playwright.chromium.connectOverCDP('http://localhost:9222')`, polled up to 20×1s (`scraper.ts:95-108`).
- Windows process cleanup uses `taskkill /F /IM chrome.exe /T` (run before launch and in `finally`, `scraper.ts:73,267`). Cancellation in `scrape-runner.ts:121-134` adds `taskkill /pid <pid> /T /F` as fallback when `SIGTERM` no-op's.
- `scrape-runner.ts:40` spawns `process.execPath` (the **Electron** binary, not `node`) with `[scraper.js, --max-pages N]`. The child env must include `ELECTRON_RUN_AS_NODE: '1'` (set at `scrape-runner.ts:42`) — without it, the spawned Electron would treat the cwd's `package.json` and start a second instance of the app instead of running the scraper. Expects `dist/scraper.js` to exist (i.e. `npm run build` first).
- Cloudflare block detection (`scraper.ts:145-153`): HTML contains `Attention Required` or `Just a moment`, OR total HTML length `< 3000`. On detection, wait 5s and retry once; fail otherwise.
- Cookie banner is auto-clicked on the **first page of each site only** (`scraper.ts:127-141`). Regex match on button text: `ACEPTO` / `Accept` / `AGREE`.
- cheerio cleanup removes: `script, style, noscript, nav, footer, header, .nav, .footer, .header, [role="navigation"]` (`scraper.ts:156`).
- Output filename format is hard-coded: `${site.id}__${slugify(url)}.json` (`scraper.ts:184`). The **double underscore** is the site/slug separator. New scrapes always use this; legacy files (pre-rename) exist as bare `<slug>.json` and the indexer still picks them up.
- `canonicalUrl(url)` (`scraper.ts:38-52`) drops hash, lowercases host, strips `www.`, removes `utm_*` / `fbclid` / `gclid`, removes trailing slash except root. **This function is duplicated** in `store.ts:261-275` (`canonicalUrlLocal`) so the store module doesn't pull in playwright/cheerio.
- Internal-link discovery (`scraper.ts:54-69`): only same-`baseUrl` links, deduped, no `javascript:` / `mailto:` / `#` fragments.
- Body extraction: `$('body').text().replace(/\s+/g, ' ').trim().substring(0, 50000)`. If result is <80 chars, wait 4s and re-parse (`scraper.ts:162-169`).
- `config.scraper.sites` (`config.ts:83-124`) defines exactly two sites: `garmoth` (garmoth.com) and `bdo` (naeu.playblackdesert.com). Add a new site by appending an object with `id` (must be a `SiteId` union member, see `types.ts:5`), `baseUrl`, `startUrls`.
- `SiteId` union is `garmoth | bdo`. To add a third site, also update `types.ts:5` and `ChunkSource` in `types.ts:2`.

## Common pitfalls

- Don't change the filename format without updating the indexer's dedup logic. The indexer deduplicates by literal `page.url` and by `canonicalUrl(page.url)`, both of which are independent of the filename (`indexer.ts:75`).
- Don't rely on `SIGTERM` alone on Windows; the `taskkill /T` fallback in `scrape-runner.ts:127-134` is required to actually kill the spawned Chrome tree.
- Don't import `scraper.ts` from the RAG side. `store.ts` deliberately re-implements `canonicalUrl` to keep playwright out of the query path.
- The `dist/scraper.js` child process inherits the parent env (incl. `BDO_DATA_DIR` if set), so changing the data dir in packaged mode is enough — no extra plumbing needed.
