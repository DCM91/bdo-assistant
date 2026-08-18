/**
 * Lanza el scraper como child_process y luego indexa automáticamente.
 * Emite progreso línea a línea para que la UI lo muestre.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { config } from './config';
import { indexAll } from './indexer';
import { store } from './store';
import type { IndexResult } from './indexer';

export type ScrapeLineKind = 'info' | 'warn' | 'error' | 'done';

export interface ScrapeOptions {
  maxPages?: number;
  reindex?: boolean;
  onLine: (line: string, kind: ScrapeLineKind) => void;
  onIndexProgress?: (msg: string) => void;
  onDone: (result: { pages: number; bySite: Record<string, number>; index: IndexResult }) => void;
  onError: (msg: string) => void;
}

export interface ScrapeHandle {
  cancel: () => void;
}

/**
 * Arranca el scraper compilado (dist/scraper.js) como subproceso.
 * Cuando stdout emite la línea final '✅ Scrape completado: N páginas',
 * dispara indexAll(reindex) y notifica con onDone.
 *
 * Si el subproceso falla, llama onError. Si llama onCancel, mata el proceso.
 */
export function startScrape(opts: ScrapeOptions): ScrapeHandle {
  const scraperJs = path.join(__dirname, 'scraper.js');
  const args = ['--max-pages', String(opts.maxPages ?? config.scraper.maxPages)];

  let proc: ChildProcessWithoutNullStreams;
  try {
    proc = spawn(process.execPath, [scraperJs, ...args], {
      cwd: path.dirname(config.paths.root),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }) as ChildProcessWithoutNullStreams;
  } catch (e) {
    opts.onError(`No se pudo lanzar el scraper: ${e instanceof Error ? e.message : e}`);
    return { cancel: () => {} };
  }

  let pagesScraped = 0;
  let bySite: Record<string, number> = {};
  let cancelled = false;
  let resolved = false;
  let buf = '';

  proc.stdout.setEncoding('utf-8');
  proc.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);
      if (!line) continue;

      // Detectar línea final del scraper: "✅ Scrape completado: N páginas (garmoth: X, bdo: Y)"
      const doneMatch = line.match(/Scrape completado: (\d+)(?: páginas)?(?: \(([^)]+)\))?/);
      if (doneMatch) {
        pagesScraped = parseInt(doneMatch[1], 10);
        if (doneMatch[2]) {
          // Parsear "garmoth: 100, bdo: 50"
          for (const part of doneMatch[2].split(',')) {
            const m = part.trim().match(/^(\w+):\s*(\d+)$/);
            if (m) bySite[m[1]] = parseInt(m[2], 10);
          }
        }
        if (!resolved) {
          resolved = true;
          runIndex(pagesScraped, bySite, opts);
        }
        opts.onLine(line, 'done');
        continue;
      }

      const kind: ScrapeLineKind = line.startsWith('✗') || line.includes('Error')
        ? 'error'
        : line.startsWith('⚠')
          ? 'warn'
          : 'info';
      opts.onLine(line, kind);
    }
  });

  proc.stderr.setEncoding('utf-8');
  proc.stderr.on('data', (chunk: string) => {
    const lines = chunk.split(/\r?\n/).filter(Boolean);
    for (const line of lines) opts.onLine('[stderr] ' + line, 'error');
  });

  proc.on('error', (e) => {
    if (!resolved) {
      resolved = true;
      opts.onError(`Error en el scraper: ${e.message}`);
    }
  });

  proc.on('close', (code) => {
    if (cancelled) return;
    if (resolved) return;
    if (code === 0) {
      // El scraper salió sin emitir la línea final (raro). Asumimos pagesScraped=0.
      resolved = true;
      runIndex(pagesScraped, bySite, opts);
    } else {
      resolved = true;
      opts.onError(`Scraper terminó con código ${code}`);
    }
  });

  return {
    cancel: () => {
      cancelled = true;
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      // En Windows SIGTERM no siempre funciona; fallback con taskkill
      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process') as typeof import('child_process');
          execSync(`taskkill /pid ${proc.pid} /T /F 2>nul`, { stdio: 'ignore' });
        } catch {
          /* ignore */
        }
      }
      opts.onError('Scrape cancelado por el usuario.');
    },
  };
}

async function runIndex(pages: number, bySite: Record<string, number>, opts: ScrapeOptions): Promise<void> {
  try {
    const result = await indexAll(opts.reindex ?? true);
    opts.onIndexProgress?.(`Indexado: +${result.newChunks} chunks (total: ${result.totalChunks})`);
    opts.onDone({ pages, bySite, index: result });
  } catch (e) {
    opts.onError(`Error en indexado: ${e instanceof Error ? e.message : e}`);
  }
}