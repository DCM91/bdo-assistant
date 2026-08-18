import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { existsSync, readFileSync, mkdirSync } from 'fs';

// ANTES de cargar el RAG: en la app empaquetada, data/ vive en userData para que
// el re-scraping no se pierda al instalar actualizaciones. NO sembramos desde
// resourcesPath: el instalador no envía el índice scrapeado (es contenido con
// copyright de terceros). El usuario debe ejecutar /scrape en el primer arranque
// para generar su propio índice local. Ver GOVERNANCE.md y README.md.
if (app.isPackaged) {
  const userDataDir = path.join(app.getPath('userData'), 'data');
  if (!existsSync(userDataDir)) {
    try {
      mkdirSync(userDataDir, { recursive: true });
    } catch {
      /* el primer scrape la creará si falla */
    }
  }
  process.env.BDO_DATA_DIR = userDataDir;
}

// ---------------------------------------------------------------------------
// Carga diferida del RAG compilado (dist/). Tipos mínimos declarados aquí para
// no arrastrar los .ts fuente al programa de UI (rootDir: src/ui).
// ---------------------------------------------------------------------------

type RerankStrategy = 'judge' | 'mmr' | 'none';

interface SourceDto {
  url: string;
  title: string;
  date: string;
}

interface QueryMetaDto {
  embedMs: number;
  searchMs: number;
  rerankMs: number;
  llmMs: number;
  totalMs: number;
  chunksScanned: number;
  candidates: number;
  rerankStrategy: string;
  cached: boolean;
}

interface QueryResultDto {
  answer: string;
  sources: SourceDto[];
  meta: QueryMetaDto;
  lowConfidence: boolean;
}

interface StatsDto {
  chunks: number;
  uniqueUrls: number;
  scrapedFiles: number;
  latestDate: string | null;
  oldestDate: string | null;
  dims: number;
  bySource: Record<string, number>;
}

interface RagModule {
  queryStream(
    question: string,
    onToken: (token: string) => void,
    options?: { rerank?: RerankStrategy; locale?: string },
  ): Promise<QueryResultDto>;
}

interface IndexedPageDto {
  url: string;
  title: string;
  source: string;
  scraped_at: string;
  chunks: number;
}

interface StoreModule {
  getStats(): StatsDto;
  getIndexedPages(): IndexedPageDto[];
  removeByUrl(url: string): number;
}

interface ScrapeRunnerModule {
  startScrape(opts: {
    maxPages?: number;
    reindex?: boolean;
    onLine: (line: string, kind: string) => void;
    onIndexProgress?: (msg: string) => void;
    onDone: (result: {
      pages: number;
      bySite: Record<string, number>;
      index: { newChunks: number; totalChunks: number; filesProcessed: number; filesSkipped: number };
    }) => void;
    onError: (msg: string) => void;
  }): { cancel: () => void };
}

const { queryStream } = require(path.join(__dirname, '..', 'dist', 'query.js')) as RagModule;
const { getStats, getIndexedPages: indexedPages, removeByUrl } = require(path.join(__dirname, '..', 'dist', 'store.js')) as StoreModule;
const { startScrape } = require(path.join(__dirname, '..', 'dist', 'scrape-runner.js')) as ScrapeRunnerModule;

/** Mensajes cortos de UI del main process, localizados. */
function busyMessage(locale: string | undefined, kind: 'busy' | 'empty'): string {
  const es = { busy: 'Ya hay una consulta en curso. Espera a que termine.', empty: 'Pregunta vacía.' };
  const en = { busy: 'A query is already in progress. Please wait.', empty: 'Empty question.' };
  const pt = { busy: 'Já há uma consulta em curso. Aguarde.', empty: 'Pergunta vazia.' };
  if (locale === 'en') return en[kind];
  if (locale === 'pt') return pt[kind];
  return es[kind];
}

function pagesCsv(): string {
  const rows = indexedPages();
  const header = ['url', 'title', 'source', 'scraped_at', 'chunks'];
  const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([esc(r.url), esc(r.title), esc(r.source), esc(r.scraped_at), String(r.chunks)].join(','));
  }
  return lines.join('\n');
}

let mainWindow: BrowserWindow | null = null;
let rerankMode: RerankStrategy = 'judge';
let asking = false;
let scraping = false;
let currentScrapeHandle: { cancel: () => void } | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    title: 'BDO Assistant',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  void mainWindow.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'));

  // Solo permitimos abrir enlaces http(s) en el navegador del sistema.
  const openExternalIfAllowed = (url: string): void => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
  };

  // Abrir enlaces externos en el navegador del sistema, nunca en Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfAllowed(url);
    return { action: 'deny' };
  });

  // Evita que un clic en un enlace (de fuentes o del LLM) navegue la ventana
  // principal de la app a una URL remota arbitraria.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    event.preventDefault();
    openExternalIfAllowed(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function registerIpc(): void {
  ipcMain.handle('question:ask', async (_event, payload: { question: string; locale?: string }) => {
    const question = typeof payload === 'string' ? payload : payload?.question;
    const locale = typeof payload === 'object' && payload ? payload.locale : undefined;

    if (asking) {
      send('stream-error', busyMessage(locale, 'busy'));
      return;
    }
    if (typeof question !== 'string' || question.trim().length === 0) {
      send('stream-error', busyMessage(locale, 'empty'));
      return;
    }

    asking = true;
    try {
      const result = await queryStream(
        question.trim(),
        (token) => send('stream-token', token),
        { rerank: rerankMode, locale },
      );
      send('stream-done', {
        sources: result.sources,
        meta: result.meta,
        lowConfidence: result.lowConfidence,
      });
    } catch (e) {
      send('stream-error', e instanceof Error ? e.message : String(e));
    } finally {
      asking = false;
    }
  });

  ipcMain.handle('stats:get', () => getStats());

  ipcMain.handle('pages:list', () => {
    try {
      return indexedPages();
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('pages:delete', (_event, url: string) => {
    try {
      const removed = removeByUrl(url);
      return { ok: true, removed };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('pages:export', () => pagesCsv());

  ipcMain.handle('rerank:set', (_event, mode: string) => {
    if (mode === 'judge' || mode === 'mmr' || mode === 'none') {
      rerankMode = mode;
    }
    return rerankMode;
  });

  ipcMain.handle('rerank:get', () => rerankMode);

  ipcMain.handle('wallpaper:get', () => getWallpaperDataUrl());

  ipcMain.handle('scrape:start', (_event, opts: { maxPages?: number } | undefined) => {
    if (scraping) {
      send('scrape:error', 'Ya hay un scrape en curso.');
      return;
    }
    scraping = true;
    currentScrapeHandle = startScrape({
      maxPages: typeof opts?.maxPages === 'number' ? opts.maxPages : undefined,
      reindex: true,
      onLine: (line, kind) => send('scrape:progress', { line, kind }),
      onIndexProgress: (msg) => send('scrape:index-progress', msg),
      onDone: (result) => {
        scraping = false;
        currentScrapeHandle = null;
        send('scrape:done', result);
      },
      onError: (msg) => {
        scraping = false;
        currentScrapeHandle = null;
        send('scrape:error', msg);
      },
    });
  });

  ipcMain.handle('scrape:cancel', () => {
    if (currentScrapeHandle) {
      currentScrapeHandle.cancel();
      currentScrapeHandle = null;
      scraping = false;
      send('scrape:cancelled');
    }
  });
}

/**
 * Resuelve la ruta del wallpaper a usar:
 * 1. Override por env var BDO_WALLPAPER_PATH
 * 2. En .exe empaquetado: process.resourcesPath/wallpaper.jpg
 * 3. En dev: Downloads/Wallpaper.jpg del usuario
 * Devuelve null si no se encuentra.
 */
function resolveWallpaperPath(): string | null {
  const env = process.env.BDO_WALLPAPER_PATH;
  if (env && existsSync(env)) return env;

  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, 'wallpaper.jpg');
    return existsSync(p) ? p : null;
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const devPath = path.join(home, 'Downloads', 'Wallpaper.jpg');
  return existsSync(devPath) ? devPath : null;
}

/** Devuelve el wallpaper como data URL (image/jpeg base64) o null. */
function getWallpaperDataUrl(): string | null {
  const p = resolveWallpaperPath();
  if (!p) return null;
  try {
    const buf = readFileSync(p);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    if (currentScrapeHandle) {
      try {
        currentScrapeHandle.cancel();
      } catch {
        /* noop */
      }
      currentScrapeHandle = null;
    }
  });

  app.whenReady()
    .then(() => {
      registerIpc();
      createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      app.quit();
    });
}
