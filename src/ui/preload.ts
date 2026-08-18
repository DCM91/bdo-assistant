import { contextBridge, ipcRenderer } from 'electron';

export interface SourceDto {
  url: string;
  title: string;
  date: string;
}

export interface QueryMetaDto {
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

export interface DonePayload {
  sources: SourceDto[];
  meta: QueryMetaDto;
  lowConfidence: boolean;
}

export interface StatsDto {
  chunks: number;
  uniqueUrls: number;
  scrapedFiles: number;
  latestDate: string | null;
  oldestDate: string | null;
  dims: number;
  bySource: Record<string, number>;
}

const api = {
  ask: (question: string): Promise<void> => ipcRenderer.invoke('question:ask', question),
  onToken: (cb: (token: string) => void): void => {
    ipcRenderer.on('stream-token', (_e, token: string) => cb(token));
  },
  onDone: (cb: (payload: DonePayload) => void): void => {
    ipcRenderer.on('stream-done', (_e, payload: DonePayload) => cb(payload));
  },
  onError: (cb: (message: string) => void): void => {
    ipcRenderer.on('stream-error', (_e, message: string) => cb(message));
  },
  getStats: (): Promise<StatsDto> => ipcRenderer.invoke('stats:get'),
  setRerank: (mode: string): Promise<string> => ipcRenderer.invoke('rerank:set', mode),
  getRerank: (): Promise<string> => ipcRenderer.invoke('rerank:get'),
  getWallpaper: (): Promise<string | null> => ipcRenderer.invoke('wallpaper:get'),
  startScrape: (opts?: { maxPages?: number }): Promise<void> =>
    ipcRenderer.invoke('scrape:start', opts ?? {}),
  cancelScrape: (): Promise<void> => ipcRenderer.invoke('scrape:cancel'),
  onScrapeProgress: (cb: (payload: { line: string; kind: string }) => void): void => {
    ipcRenderer.on('scrape:progress', (_e, payload) => cb(payload));
  },
  onScrapeIndexProgress: (cb: (msg: string) => void): void => {
    ipcRenderer.on('scrape:index-progress', (_e, msg: string) => cb(msg));
  },
  onScrapeDone: (cb: (payload: { pages: number; bySite: Record<string, number>; index: unknown }) => void): void => {
    ipcRenderer.on('scrape:done', (_e, payload) => cb(payload));
  },
  onScrapeError: (cb: (msg: string) => void): void => {
    ipcRenderer.on('scrape:error', (_e, msg: string) => cb(msg));
  },
};

export type BdoApi = typeof api;

contextBridge.exposeInMainWorld('bdo', api);
