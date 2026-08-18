import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';

// ANTES de cargar el RAG: en la app empaquetada, data/ vive en resources
if (app.isPackaged) {
  process.env.BDO_DATA_DIR = path.join(process.resourcesPath, 'data');
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
    options?: { rerank?: RerankStrategy },
  ): Promise<QueryResultDto>;
}

interface StoreModule {
  getStats(): StatsDto;
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
const { getStats } = require(path.join(__dirname, '..', 'dist', 'store.js')) as StoreModule;
const { startScrape } = require(path.join(__dirname, '..', 'dist', 'scrape-runner.js')) as ScrapeRunnerModule;

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

  // Abrir enlaces externos en el navegador del sistema, nunca en Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
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
  ipcMain.handle('question:ask', async (_event, question: string) => {
    if (asking) {
      send('stream-error', 'Ya hay una consulta en curso. Espera a que termine.');
      return;
    }
    if (typeof question !== 'string' || question.trim().length === 0) {
      send('stream-error', 'Pregunta vacía.');
      return;
    }

    asking = true;
    try {
      const result = await queryStream(
        question.trim(),
        (token) => send('stream-token', token),
        { rerank: rerankMode },
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

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
