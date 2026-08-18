/**
 * Renderer del chat. Se comunica con el main process via window.bdo (preload).
 * Renderiza markdown con marked (UMD cargado en index.html) y sanitiza HTML.
 */

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

interface DonePayload {
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

interface BdoApi {
  ask(question: string): Promise<void>;
  onToken(cb: (token: string) => void): void;
  onDone(cb: (payload: DonePayload) => void): void;
  onError(cb: (message: string) => void): void;
  getStats(): Promise<StatsDto>;
  setRerank(mode: string): Promise<string>;
  getRerank(): Promise<string>;
  getWallpaper(): Promise<string | null>;
  startScrape(opts?: { maxPages?: number }): Promise<void>;
  cancelScrape(): Promise<void>;
  onScrapeProgress(cb: (payload: { line: string; kind: string }) => void): void;
  onScrapeIndexProgress(cb: (msg: string) => void): void;
  onScrapeDone(cb: (payload: { pages: number; bySite: Record<string, number>; index: unknown }) => void): void;
  onScrapeError(cb: (msg: string) => void): void;
}

declare const bdo: BdoApi;
declare const marked: {
  parse(text: string, options?: { gfm?: boolean; breaks?: boolean }): string;
};

const messagesEl = document.getElementById('messages') as HTMLDivElement;
const welcomeEl = document.getElementById('welcome') as HTMLDivElement;
const inputEl = document.getElementById('question-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const rerankSelect = document.getElementById('rerank-select') as HTMLSelectElement;
const statsBtn = document.getElementById('stats-btn') as HTMLButtonElement;
const statsModal = document.getElementById('stats-modal') as HTMLDivElement;
const statsBody = document.getElementById('stats-body') as HTMLDivElement;
const statsClose = document.getElementById('stats-close') as HTMLButtonElement;

const scrapeBtn = document.getElementById('scrape-btn') as HTMLButtonElement;
const scrapeToast = document.getElementById('scrape-toast') as HTMLDivElement;
const toastTitle = document.getElementById('toast-title') as HTMLSpanElement;
const toastBody = document.getElementById('toast-body') as HTMLDivElement;
const toastCancel = document.getElementById('toast-cancel') as HTMLButtonElement;

let busy = false;
let currentAssistantEl: HTMLDivElement | null = null;
let currentAnswerEl: HTMLDivElement | null = null;
let accumulated = '';

/** Escapa HTML para inserción segura como texto. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renderiza markdown de forma segura: escapa primero el HTML crudo
 * (el LLM podría colar <script> o <img onerror>) y luego aplica marked.
 * Tras el parse, reemplaza [ref:N] por badges coloreados.
 */
function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  const html = marked.parse(escaped, { gfm: true, breaks: true });
  return html.replace(/\[ref:(\d+)\]/g, '<code>[ref:$1]</code>');
}

function scrollToBottom(): void {
  const area = document.getElementById('chat-area') as HTMLDivElement;
  area.scrollTop = area.scrollHeight;
}

function hideWelcome(): void {
  if (!welcomeEl.classList.contains('hidden')) {
    welcomeEl.style.display = 'none';
  }
}

function addUserMessage(text: string): void {
  const el = document.createElement('div');
  el.className = 'message user';
  el.textContent = text;
  messagesEl.appendChild(el);
}

function addAssistantShell(): void {
  currentAssistantEl = document.createElement('div');
  currentAssistantEl.className = 'message assistant';

  currentAnswerEl = document.createElement('div');
  currentAnswerEl.className = 'answer typing-cursor';
  currentAssistantEl.appendChild(currentAnswerEl);

  messagesEl.appendChild(currentAssistantEl);
  accumulated = '';
}

function addErrorMessage(text: string): void {
  const el = document.createElement('div');
  el.className = 'message error';
  el.textContent = '⚠ ' + text;
  messagesEl.appendChild(el);
}

function finalizeAssistant(payload: DonePayload): void {
  if (!currentAssistantEl || !currentAnswerEl) return;

  currentAnswerEl.classList.remove('typing-cursor');
  currentAnswerEl.innerHTML = renderMarkdown(accumulated);

  if (payload.lowConfidence) {
    const warn = document.createElement('div');
    warn.className = 'low-confidence';
    warn.textContent = '⚠ Confianza baja: la respuesta puede no estar bien fundamentada en las fuentes.';
    currentAssistantEl.appendChild(warn);
  }

  if (payload.sources.length > 0) {
    const sourcesEl = document.createElement('div');
    sourcesEl.className = 'sources';

    const title = document.createElement('div');
    title.className = 'sources-title';
    title.textContent = 'Fuentes:';
    sourcesEl.appendChild(title);

    payload.sources.forEach((s, i) => {
      const a = document.createElement('a');
      a.href = s.url;
      const date = s.date ? s.date.split('T')[0] : 'sin fecha';
      a.textContent = `[${i + 1}] ${s.title} (${date})`;
      a.title = s.url;
      sourcesEl.appendChild(a);
    });

    currentAssistantEl.appendChild(sourcesEl);
  }

  const m = payload.meta;
  const metaEl = document.createElement('div');
  metaEl.className = 'meta-line';
  metaEl.textContent =
    `⏱ ${(m.totalMs / 1000).toFixed(1)}s · embed ${m.embedMs}ms${m.cached ? ' (caché)' : ''}` +
    ` · búsqueda ${m.searchMs}ms · rerank ${m.rerankMs}ms [${m.rerankStrategy}]` +
    ` · llm ${m.llmMs}ms · ${m.candidates}/${m.chunksScanned} chunks`;
  currentAssistantEl.appendChild(metaEl);

  currentAssistantEl = null;
  currentAnswerEl = null;
  accumulated = '';
}

function setBusy(value: boolean): void {
  busy = value;
  sendBtn.disabled = value;
  inputEl.disabled = value;
  if (!value) inputEl.focus();
}

function ask(question: string): void {
  const q = question.trim();
  if (!q || busy) return;

  hideWelcome();
  addUserMessage(q);
  addAssistantShell();
  scrollToBottom();

  inputEl.value = '';
  inputEl.style.height = 'auto';
  setBusy(true);

  void bdo.ask(q);
}

// ---------- Eventos IPC ----------

bdo.onToken((token) => {
  if (!currentAnswerEl) return;
  accumulated += token;
  // Re-render incremental: marked sobre lo acumulado.
  currentAnswerEl.innerHTML = renderMarkdown(accumulated);
  scrollToBottom();
});

bdo.onDone((payload) => {
  finalizeAssistant(payload);
  setBusy(false);
  scrollToBottom();
});

bdo.onError((message) => {
  if (currentAssistantEl) {
    currentAssistantEl.remove();
    currentAssistantEl = null;
    currentAnswerEl = null;
    accumulated = '';
  }
  addErrorMessage(message);
  setBusy(false);
  scrollToBottom();
});

// ---------- Eventos DOM ----------

sendBtn.addEventListener('click', () => ask(inputEl.value));

inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    ask(inputEl.value);
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
});

document.querySelectorAll('.example').forEach((btn) => {
  btn.addEventListener('click', () => {
    ask((btn as HTMLButtonElement).textContent ?? '');
  });
});

// ---------- Rerank ----------

rerankSelect.addEventListener('change', () => {
  void bdo.setRerank(rerankSelect.value);
});

void bdo.getRerank().then((mode) => {
  rerankSelect.value = mode;
});

// ---------- Stats modal ----------

statsBtn.addEventListener('click', () => {
  statsModal.classList.remove('hidden');
  statsBody.textContent = 'Cargando…';
  void bdo.getStats().then((s) => {
    const bySourceRows = Object.entries(s.bySource)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `&nbsp;&nbsp;↳ ${escapeHtml(k)}: ${v}`)
      .join('<br>');
    const bySourceBlock = bySourceRows
      ? `<div class="stat-row" style="flex-direction:column;align-items:stretch;gap:2px"><span>Por fuente</span><span class="stat-value" style="text-align:left">${bySourceRows}</span></div>`
      : '';
    statsBody.innerHTML = [
      row('Chunks indexados', s.chunks),
      row('URLs únicas', s.uniqueUrls),
      row('Páginas scrapeadas', s.scrapedFiles),
      row('Dimensiones embedding', s.dims),
      row('Datos más recientes', s.latestDate ?? '—'),
      row('Datos más antiguos', s.oldestDate ?? '—'),
      bySourceBlock,
    ].filter(Boolean).join('');
  });

  function row(label: string, value: string | number): string {
    return `<div class="stat-row"><span>${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(String(value))}</span></div>`;
  }
});

statsClose.addEventListener('click', () => statsModal.classList.add('hidden'));
statsModal.addEventListener('click', (e) => {
  if (e.target === statsModal) statsModal.classList.add('hidden');
});

// ---------- Scrape (toast de progreso) ----------

let scrapeRunning = false;

function appendToastLine(text: string, kind: string): void {
  const line = document.createElement('div');
  line.className = 'line-' + (kind || 'info');
  line.textContent = text;
  toastBody.appendChild(line);
  toastBody.scrollTop = toastBody.scrollHeight;
}

function resetToast(title: string): void {
  toastTitle.textContent = title;
  toastBody.innerHTML = '';
  scrapeToast.classList.remove('hidden');
}

function closeToast(): void {
  scrapeToast.classList.add('hidden');
  scrapeBtn.disabled = false;
  scrapeRunning = false;
}

scrapeBtn.addEventListener('click', () => {
  if (scrapeRunning) return;
  scrapeRunning = true;
  scrapeBtn.disabled = true;
  resetToast('🔄 Scrapeando garmoth.com…');
  appendToastLine('Lanzando scraper…', 'info');
  void bdo.startScrape();
});

toastCancel.addEventListener('click', () => {
  if (!scrapeRunning) {
    closeToast();
    return;
  }
  toastCancel.disabled = true;
  toastCancel.textContent = 'Cancelando…';
  appendToastLine('Cancelando scrape…', 'warn');
  void bdo.cancelScrape();
});

bdo.onScrapeProgress((payload) => {
  appendToastLine(payload.line, payload.kind);
});

bdo.onScrapeIndexProgress((msg) => {
  appendToastLine('🔨 ' + msg, 'info');
});

bdo.onScrapeDone((payload) => {
  const p = payload as { pages: number; bySite: Record<string, number>; index: { newChunks: number; totalChunks: number } };
  toastTitle.textContent = '✅ Scrape completo';
  appendToastLine(`Páginas scrapeadas: ${p.pages}`, 'done');
  if (p.bySite && Object.keys(p.bySite).length > 0) {
    const breakdown = Object.entries(p.bySite)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    appendToastLine(`Por sitio: ${breakdown}`, 'done');
  }
  appendToastLine(`Chunks totales: ${p.index.totalChunks} (+${p.index.newChunks} nuevos)`, 'done');
  toastCancel.textContent = 'Cerrar';
  toastCancel.disabled = false;
  scrapeRunning = false;
});

bdo.onScrapeError((msg) => {
  toastTitle.textContent = '❌ Error';
  appendToastLine(msg, 'error');
  toastCancel.textContent = 'Cerrar';
  toastCancel.disabled = false;
  scrapeRunning = false;
});

// ---------- Wallpaper de fondo ----------

void bdo.getWallpaper().then((dataUrl) => {
  if (dataUrl) {
    const layer = document.getElementById('bg-layer');
    if (layer) layer.style.backgroundImage = `url("${dataUrl}")`;
  }
});

inputEl.focus();
