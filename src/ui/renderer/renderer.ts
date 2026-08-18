/**
 * Renderer del chat. Se comunica con el main process via window.bdo (preload).
 * Renderiza markdown con marked (UMD cargado en index.html) y sanitiza HTML.
 *
 * Localización: `TR` contiene los strings ES/EN/PT. `t(key, vars)` resuelve la
 * clave en el idioma activo (persistido en localStorage). El idioma también se
 * envía a la RAG (`bdo.ask(question, { locale })`) para localizar los prompts
 * del LLM.
 *
 * IMPORTANTE: la constante `TR` está duplicada respecto a `src/i18n/locales.ts`
 * porque `tsconfig.renderer.json` usa `module: none` y los rootDirs no permiten
 * importar desde `src/`. Si modificas las claves aquí, sincroniza también el
 * archivo del RAG.
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

interface IndexedPageDto {
  url: string;
  title: string;
  source: string;
  scraped_at: string;
  chunks: number;
}

interface BdoApi {
  ask(question: string, opts?: { locale?: string }): Promise<void>;
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
  onScrapeCancelled(cb: () => void): void;
  listPages(): Promise<IndexedPageDto[]>;
  deletePage(url: string): Promise<{ ok: boolean; removed?: number; error?: string }>;
  exportPagesCsv(): Promise<string>;
}

declare const bdo: BdoApi;
declare const marked: {
  parse(text: string, options?: { gfm?: boolean; breaks?: boolean }): string;
};

// ============================================================================
// i18n (duplicado de src/i18n/locales.ts por restricciones de rootDir)
// ============================================================================

type Locale = 'es' | 'en' | 'pt';

const SUPPORTED_LOCALES: readonly Locale[] = ['es', 'en', 'pt'];
const DEFAULT_LOCALE: Locale = 'es';

const TR: Record<Locale, Record<string, string>> = {
  es: {
    'header.title': 'BDO Assistant',
    'header.subtitle': 'garmoth.com + Ollama',
    'header.localeLabel': 'idioma',
    'header.rerankLabel': 'rerank',
    'header.scrapeButton': '🔄 Re-scrapear',
    'header.scrapeTitle': 'Re-scrapear y re-indexar',
    'header.statsButton': '📊 Stats',
    'header.statsTitle': 'Estadísticas del índice',
    'header.linksButton': '🔗 Páginas',
    'header.linksTitle': 'Páginas indexadas',
    'welcome.title': '¿En qué te ayudo, aventurero?',
    'welcome.subtitle': 'Pregunta sobre clases, gear, eventos, cupones o guías de Black Desert Online.',
    'welcome.example1': '¿Qué eventos hay activos ahora?',
    'welcome.example2': '¿Cómo funcionan las Dream Horses?',
    'welcome.example3': '¿Qué es la Dehkia’s Lantern?',
    'input.placeholder': 'Escribe tu pregunta sobre BDO… (Enter para enviar, Shift+Enter para salto de línea)',
    'input.sendTitle': 'Enviar',
    'stats.title': '📊 Estadísticas del índice',
    'stats.closeTitle': 'Cerrar',
    'stats.loading': 'Cargando…',
    'stats.errorPrefix': '⚠',
    'stats.chunks': 'Chunks indexados',
    'stats.urls': 'URLs únicas',
    'stats.scrapedFiles': 'Páginas scrapeadas',
    'stats.dims': 'Dimensiones embedding',
    'stats.latest': 'Datos más recientes',
    'stats.oldest': 'Datos más antiguos',
    'stats.bySource': 'Por fuente',
    'scrape.title': '🔄 Scrapeando garmoth.com…',
    'scrape.launching': 'Lanzando scraper…',
    'scrape.cancelling': 'Cancelando…',
    'scrape.cancel': 'Cancelar',
    'scrape.cancellingLine': 'Cancelando scrape…',
    'scrape.cancelLine': 'Cancelado por el usuario.',
    'scrape.done': '✅ Scrape completo',
    'scrape.error': '❌ Error',
    'scrape.cancelled': '⛔ Scrape cancelado',
    'scrape.close': 'Cerrar',
    'scrape.errorLaunching': 'Error lanzando el scraper: {msg}',
    'scrape.pagesScraped': 'Páginas scrapeadas: {count}',
    'scrape.bySite': 'Por sitio: {breakdown}',
    'scrape.totalChunks': 'Chunks totales: {total} (+{added} nuevos)',
    'chat.errorPrefix': '⚠',
    'chat.lowConfidence': '⚠ Confianza baja: la respuesta puede no estar bien fundamentada en las fuentes.',
    'chat.sources': 'Fuentes:',
    'chat.metaTemplate': '⏱ {seconds}s · embed {embed}ms{cached} · búsqueda {search}ms · rerank {rerank}ms [{strategy}] · llm {llm}ms · {candidates}/{scanned} chunks',
    'chat.metaCached': ' (caché)',
    'pages.title': '🔗 Páginas indexadas',
    'pages.searchPlaceholder': 'Buscar por título o URL…',
    'pages.colIndex': '#',
    'pages.colTitle': 'Título',
    'pages.colUrl': 'URL',
    'pages.colDate': 'Fecha',
    'pages.colSource': 'Fuente',
    'pages.colChunks': 'Chunks',
    'pages.colActions': 'Acciones',
    'pages.delete': 'Eliminar',
    'pages.confirmDelete': '¿Eliminar {count} chunks de esta URL del índice? El archivo scrapeado en disco no se borra.',
    'pages.export': 'Exportar CSV',
    'pages.empty': 'No hay páginas indexadas.',
    'pages.noResults': 'Ningún resultado para tu búsqueda.',
    'pages.deletedToast': 'Eliminados {count} chunks de {url}',
    'pages.deletedNoneToast': 'No se encontraron chunks para esa URL.',
    'pages.failedToast': 'Error eliminando {url}: {msg}',
  },
  en: {
    'header.title': 'BDO Assistant',
    'header.subtitle': 'garmoth.com + Ollama',
    'header.localeLabel': 'language',
    'header.rerankLabel': 'rerank',
    'header.scrapeButton': '🔄 Re-scrape',
    'header.scrapeTitle': 'Re-scrape and re-index',
    'header.statsButton': '📊 Stats',
    'header.statsTitle': 'Index statistics',
    'header.linksButton': '🔗 Pages',
    'header.linksTitle': 'Indexed pages',
    'welcome.title': 'How can I help, adventurer?',
    'welcome.subtitle': 'Ask about classes, gear, events, coupons or guides for Black Desert Online.',
    'welcome.example1': 'What events are active right now?',
    'welcome.example2': 'How do Dream Horses work?',
    'welcome.example3': 'What is Dehkia’s Lantern?',
    'input.placeholder': 'Type your BDO question… (Enter to send, Shift+Enter for newline)',
    'input.sendTitle': 'Send',
    'stats.title': '📊 Index statistics',
    'stats.closeTitle': 'Close',
    'stats.loading': 'Loading…',
    'stats.errorPrefix': '⚠',
    'stats.chunks': 'Indexed chunks',
    'stats.urls': 'Unique URLs',
    'stats.scrapedFiles': 'Scraped pages',
    'stats.dims': 'Embedding dimensions',
    'stats.latest': 'Latest data',
    'stats.oldest': 'Oldest data',
    'stats.bySource': 'By source',
    'scrape.title': '🔄 Scraping garmoth.com…',
    'scrape.launching': 'Launching scraper…',
    'scrape.cancelling': 'Cancelling…',
    'scrape.cancel': 'Cancel',
    'scrape.cancellingLine': 'Cancelling scrape…',
    'scrape.cancelLine': 'Cancelled by user.',
    'scrape.done': '✅ Scrape complete',
    'scrape.error': '❌ Error',
    'scrape.cancelled': '⛔ Scrape cancelled',
    'scrape.close': 'Close',
    'scrape.errorLaunching': 'Error launching scraper: {msg}',
    'scrape.pagesScraped': 'Pages scraped: {count}',
    'scrape.bySite': 'By site: {breakdown}',
    'scrape.totalChunks': 'Total chunks: {total} (+{added} new)',
    'chat.errorPrefix': '⚠',
    'chat.lowConfidence': '⚠ Low confidence: the answer may not be well grounded in the sources.',
    'chat.sources': 'Sources:',
    'chat.metaTemplate': '⏱ {seconds}s · embed {embed}ms{cached} · search {search}ms · rerank {rerank}ms [{strategy}] · llm {llm}ms · {candidates}/{scanned} chunks',
    'chat.metaCached': ' (cached)',
    'pages.title': '🔗 Indexed pages',
    'pages.searchPlaceholder': 'Search by title or URL…',
    'pages.colIndex': '#',
    'pages.colTitle': 'Title',
    'pages.colUrl': 'URL',
    'pages.colDate': 'Date',
    'pages.colSource': 'Source',
    'pages.colChunks': 'Chunks',
    'pages.colActions': 'Actions',
    'pages.delete': 'Delete',
    'pages.confirmDelete': 'Delete {count} chunks of this URL from the index? The scraped file on disk is kept.',
    'pages.export': 'Export CSV',
    'pages.empty': 'No indexed pages.',
    'pages.noResults': 'No results for your search.',
    'pages.deletedToast': 'Deleted {count} chunks from {url}',
    'pages.deletedNoneToast': 'No chunks found for that URL.',
    'pages.failedToast': 'Error deleting {url}: {msg}',
  },
  pt: {
    'header.title': 'BDO Assistant',
    'header.subtitle': 'garmoth.com + Ollama',
    'header.localeLabel': 'idioma',
    'header.rerankLabel': 'rerank',
    'header.scrapeButton': '🔄 Re-raspar',
    'header.scrapeTitle': 'Re-raspar e reindexar',
    'header.statsButton': '📊 Stats',
    'header.statsTitle': 'Estatísticas do índice',
    'header.linksButton': '🔗 Páginas',
    'header.linksTitle': 'Páginas indexadas',
    'welcome.title': 'Em que posso ajudar, aventureiro?',
    'welcome.subtitle': 'Pergunte sobre classes, gear, eventos, cupons ou guias de Black Desert Online.',
    'welcome.example1': 'Quais eventos estão ativos agora?',
    'welcome.example2': 'Como funcionam os Dream Horses?',
    'welcome.example3': 'O que é a Dehkia’s Lantern?',
    'input.placeholder': 'Digite sua pergunta sobre BDO… (Enter para enviar, Shift+Enter para nova linha)',
    'input.sendTitle': 'Enviar',
    'stats.title': '📊 Estatísticas do índice',
    'stats.closeTitle': 'Fechar',
    'stats.loading': 'Carregando…',
    'stats.errorPrefix': '⚠',
    'stats.chunks': 'Chunks indexados',
    'stats.urls': 'URLs únicas',
    'stats.scrapedFiles': 'Páginas raspadas',
    'stats.dims': 'Dimensões do embedding',
    'stats.latest': 'Dados mais recentes',
    'stats.oldest': 'Dados mais antigos',
    'stats.bySource': 'Por fonte',
    'scrape.title': '🔄 Raspando garmoth.com…',
    'scrape.launching': 'Iniciando scraper…',
    'scrape.cancelling': 'Cancelando…',
    'scrape.cancel': 'Cancelar',
    'scrape.cancellingLine': 'Cancelando scrape…',
    'scrape.cancelLine': 'Cancelado pelo usuário.',
    'scrape.done': '✅ Scrape concluído',
    'scrape.error': '❌ Erro',
    'scrape.cancelled': '⛔ Scrape cancelado',
    'scrape.close': 'Fechar',
    'scrape.errorLaunching': 'Erro ao iniciar o scraper: {msg}',
    'scrape.pagesScraped': 'Páginas raspadas: {count}',
    'scrape.bySite': 'Por site: {breakdown}',
    'scrape.totalChunks': 'Chunks totais: {total} (+{added} novos)',
    'chat.errorPrefix': '⚠',
    'chat.lowConfidence': '⚠ Baixa confiança: a resposta pode não estar bem fundamentada nas fontes.',
    'chat.sources': 'Fontes:',
    'chat.metaTemplate': '⏱ {seconds}s · embed {embed}ms{cached} · busca {search}ms · rerank {rerank}ms [{strategy}] · llm {llm}ms · {candidates}/{scanned} chunks',
    'chat.metaCached': ' (cache)',
    'pages.title': '🔗 Páginas indexadas',
    'pages.searchPlaceholder': 'Buscar por título ou URL…',
    'pages.colIndex': '#',
    'pages.colTitle': 'Título',
    'pages.colUrl': 'URL',
    'pages.colDate': 'Data',
    'pages.colSource': 'Fonte',
    'pages.colChunks': 'Chunks',
    'pages.colActions': 'Ações',
    'pages.delete': 'Excluir',
    'pages.confirmDelete': 'Excluir {count} chunks desta URL do índice? O arquivo raspado no disco é mantido.',
    'pages.export': 'Exportar CSV',
    'pages.empty': 'Nenhuma página indexada.',
    'pages.noResults': 'Nenhum resultado para sua busca.',
    'pages.deletedToast': 'Excluídos {count} chunks de {url}',
    'pages.deletedNoneToast': 'Nenhum chunk encontrado para esta URL.',
    'pages.failedToast': 'Erro ao excluir {url}: {msg}',
  },
};

const LOCALE_STORAGE_KEY = 'bdo.locale';

function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function loadStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v && isSupportedLocale(v)) return v;
  } catch {
    /* localStorage puede estar deshabilitado en contextos sandbox */
  }
  return DEFAULT_LOCALE;
}

let currentLocale: Locale = loadStoredLocale();

function t(key: string, vars?: Record<string, string | number>): string {
  const dict = TR[currentLocale];
  let s = dict[key] ?? TR[DEFAULT_LOCALE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

function applyTranslations(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  }
  for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    '[data-i18n-placeholder]',
  )) {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  }
}

function setLocale(locale: Locale): void {
  currentLocale = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* noop */
  }
  applyTranslations();
}

// ============================================================================
// DOM refs
// ============================================================================

const messagesEl = document.getElementById('messages') as HTMLDivElement;
const welcomeEl = document.getElementById('welcome') as HTMLDivElement;
const inputEl = document.getElementById('question-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const rerankSelect = document.getElementById('rerank-select') as HTMLSelectElement;
const localeSelect = document.getElementById('locale-select') as HTMLSelectElement;
const statsBtn = document.getElementById('stats-btn') as HTMLButtonElement;
const statsModal = document.getElementById('stats-modal') as HTMLDivElement;
const statsBody = document.getElementById('stats-body') as HTMLDivElement;
const statsClose = document.getElementById('stats-close') as HTMLButtonElement;

const linksBtn = document.getElementById('links-btn') as HTMLButtonElement;
const pagesModal = document.getElementById('pages-modal') as HTMLDivElement;
const pagesClose = document.getElementById('pages-close') as HTMLButtonElement;
const pagesSearch = document.getElementById('pages-search') as HTMLInputElement;
const pagesExport = document.getElementById('pages-export') as HTMLButtonElement;
const pagesTable = document.getElementById('pages-table') as HTMLTableElement;
const pagesTbody = document.getElementById('pages-tbody') as HTMLTableSectionElement;
const pagesEmpty = document.getElementById('pages-empty') as HTMLDivElement;
const pagesNoResults = document.getElementById('pages-no-results') as HTMLDivElement;
const pagesError = document.getElementById('pages-error') as HTMLDivElement;

const scrapeBtn = document.getElementById('scrape-btn') as HTMLButtonElement;
const scrapeToast = document.getElementById('scrape-toast') as HTMLDivElement;
const toastTitle = document.getElementById('toast-title') as HTMLSpanElement;
const toastBody = document.getElementById('toast-body') as HTMLDivElement;
const toastCancel = document.getElementById('toast-cancel') as HTMLButtonElement;

let busy = false;
let currentAssistantEl: HTMLDivElement | null = null;
let currentAnswerEl: HTMLDivElement | null = null;
let accumulated = '';
let allPages: IndexedPageDto[] = [];
let pagesSearchTerm = '';

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
 * y luego aplica marked. Tras el parse, reemplaza [ref:N] por badges coloreados.
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

/** Solo hace scroll si el usuario ya estaba cerca del fondo. */
function autoScrollIfNearBottom(): void {
  const area = document.getElementById('chat-area') as HTMLDivElement;
  const threshold = 80;
  if (area.scrollHeight - area.scrollTop - area.clientHeight < threshold) {
    area.scrollTop = area.scrollHeight;
  }
}

let pendingRender = false;
function scheduleRender(): void {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    if (!currentAnswerEl) return;
    currentAnswerEl.innerHTML = renderMarkdown(accumulated);
    autoScrollIfNearBottom();
  });
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
  el.textContent = t('chat.errorPrefix') + ' ' + text;
  messagesEl.appendChild(el);
}

function finalizeAssistant(payload: DonePayload): void {
  if (!currentAssistantEl || !currentAnswerEl) return;

  currentAnswerEl.classList.remove('typing-cursor');
  currentAnswerEl.innerHTML = renderMarkdown(accumulated);

  if (payload.lowConfidence) {
    const warn = document.createElement('div');
    warn.className = 'low-confidence';
    warn.textContent = t('chat.lowConfidence');
    currentAssistantEl.appendChild(warn);
  }

  if (payload.sources.length > 0) {
    const sourcesEl = document.createElement('div');
    sourcesEl.className = 'sources';

    const title = document.createElement('div');
    title.className = 'sources-title';
    title.textContent = t('chat.sources');
    sourcesEl.appendChild(title);

    payload.sources.forEach((s, i) => {
      const a = document.createElement('a');
      a.href = /^https?:\/\//i.test(s.url) ? s.url : '#';
      a.rel = 'noopener noreferrer';
      const date = s.date ? s.date.split('T')[0] : '—';
      a.textContent = `[${i + 1}] ${s.title || s.url} (${date})`;
      a.title = s.url;
      sourcesEl.appendChild(a);
    });

    currentAssistantEl.appendChild(sourcesEl);
  }

  const m = payload.meta;
  const metaEl = document.createElement('div');
  metaEl.className = 'meta-line';
  metaEl.textContent = t('chat.metaTemplate', {
    seconds: (m.totalMs / 1000).toFixed(1),
    embed: m.embedMs,
    cached: m.cached ? t('chat.metaCached') : '',
    search: m.searchMs,
    rerank: m.rerankMs,
    strategy: m.rerankStrategy,
    llm: m.llmMs,
    candidates: m.candidates,
    scanned: m.chunksScanned,
  });
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

  void bdo.ask(q, { locale: currentLocale });
}

// ============================================================================
// Eventos IPC
// ============================================================================

bdo.onToken((token) => {
  if (!currentAnswerEl) return;
  accumulated += token;
  scheduleRender();
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

// ============================================================================
// Eventos DOM
// ============================================================================

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

localeSelect.value = currentLocale;
localeSelect.addEventListener('change', () => {
  const v = localeSelect.value;
  if (isSupportedLocale(v)) setLocale(v);
});

// ============================================================================
// Rerank
// ============================================================================

rerankSelect.addEventListener('change', () => {
  void bdo.setRerank(rerankSelect.value);
});

void bdo
  .getRerank()
  .then((mode) => {
    rerankSelect.value = mode;
  })
  .catch(() => {
    /* el select queda con su valor por defecto */
  });

// ============================================================================
// Modal de stats
// ============================================================================

statsBtn.addEventListener('click', () => {
  statsModal.classList.remove('hidden');
  statsBody.textContent = t('stats.loading');
  void bdo
    .getStats()
    .then((s) => {
      const bySourceRows = Object.entries(s.bySource)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `&nbsp;&nbsp;↳ ${escapeHtml(k)}: ${v}`)
        .join('<br>');
      const bySourceBlock = bySourceRows
        ? `<div class="stat-row" style="flex-direction:column;align-items:stretch;gap:2px"><span>${t('stats.bySource')}</span><span class="stat-value" style="text-align:left">${bySourceRows}</span></div>`
        : '';
      statsBody.innerHTML = [
        row('stats.chunks', s.chunks),
        row('stats.urls', s.uniqueUrls),
        row('stats.scrapedFiles', s.scrapedFiles),
        row('stats.dims', s.dims),
        row('stats.latest', s.latestDate ?? '—'),
        row('stats.oldest', s.oldestDate ?? '—'),
        bySourceBlock,
      ]
        .filter(Boolean)
        .join('');
    })
    .catch((e) => {
      statsBody.textContent = t('stats.errorPrefix') + ' ' + (e instanceof Error ? e.message : String(e));
    });

  function row(key: string, value: string | number): string {
    return `<div class="stat-row"><span>${t(key)}</span><span class="stat-value">${escapeHtml(String(value))}</span></div>`;
  }
});

statsClose.addEventListener('click', () => statsModal.classList.add('hidden'));
statsModal.addEventListener('click', (e) => {
  if (e.target === statsModal) statsModal.classList.add('hidden');
});
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (!statsModal.classList.contains('hidden')) statsModal.classList.add('hidden');
    if (!pagesModal.classList.contains('hidden')) pagesModal.classList.add('hidden');
  }
});

// ============================================================================
// Modal de páginas indexadas
// ============================================================================

function shortUrl(u: string): string {
  return u.length > 60 ? u.slice(0, 57) + '…' : u;
}

function renderPagesTable(): void {
  const q = pagesSearchTerm.toLowerCase();
  const filtered = q
    ? allPages.filter(
        (p) => (p.title + ' ' + p.url).toLowerCase().includes(q),
      )
    : allPages;

  pagesTbody.innerHTML = '';

  if (allPages.length === 0) {
    pagesEmpty.classList.remove('hidden');
    pagesNoResults.classList.add('hidden');
    pagesTable.classList.add('hidden');
    pagesError.classList.add('hidden');
    return;
  }

  if (filtered.length === 0) {
    pagesNoResults.classList.remove('hidden');
    pagesTable.classList.add('hidden');
    pagesError.classList.add('hidden');
    pagesEmpty.classList.add('hidden');
    return;
  }

  pagesEmpty.classList.add('hidden');
  pagesNoResults.classList.add('hidden');
  pagesError.classList.add('hidden');
  pagesTable.classList.remove('hidden');

  for (let i = 0; i < filtered.length; i++) {
    const p = filtered[i];
    const tr = document.createElement('tr');

    const tdNum = document.createElement('td');
    tdNum.className = 'col-num';
    tdNum.textContent = String(i + 1);
    tr.appendChild(tdNum);

    const tdTitle = document.createElement('td');
    tdTitle.textContent = p.title || p.url;
    tr.appendChild(tdTitle);

    const tdUrl = document.createElement('td');
    tdUrl.className = 'col-url';
    const a = document.createElement('a');
    a.href = /^https?:\/\//i.test(p.url) ? p.url : '#';
    a.rel = 'noopener noreferrer';
    a.textContent = shortUrl(p.url);
    a.title = p.url;
    tdUrl.appendChild(a);
    tr.appendChild(tdUrl);

    const tdDate = document.createElement('td');
    tdDate.textContent = p.scraped_at ? p.scraped_at.split('T')[0] : '—';
    tr.appendChild(tdDate);

    const tdSource = document.createElement('td');
    tdSource.textContent = p.source;
    tr.appendChild(tdSource);

    const tdChunks = document.createElement('td');
    tdChunks.className = 'col-num';
    tdChunks.textContent = String(p.chunks);
    tr.appendChild(tdChunks);

    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t('pages.delete');
    btn.addEventListener('click', () => {
      if (!confirm(t('pages.confirmDelete', { count: p.chunks }))) return;
      void bdo
        .deletePage(p.url)
        .then((res) => {
          if (res.ok) {
            if (res.removed && res.removed > 0) {
              addErrorMessage(t('pages.deletedToast', { count: res.removed, url: p.url }));
              void loadPages();
            } else {
              addErrorMessage(t('pages.deletedNoneToast'));
            }
          } else {
            addErrorMessage(t('pages.failedToast', { url: p.url, msg: res.error ?? '' }));
          }
        })
        .catch((e) => {
          addErrorMessage(t('pages.failedToast', { url: p.url, msg: String(e) }));
        });
    });
    tdActions.appendChild(btn);
    tr.appendChild(tdActions);

    pagesTbody.appendChild(tr);
  }
}

async function loadPages(): Promise<void> {
  try {
    allPages = await bdo.listPages();
  } catch (e) {
    allPages = [];
    pagesError.textContent = t('stats.errorPrefix') + ' ' + (e instanceof Error ? e.message : String(e));
    pagesError.classList.remove('hidden');
    pagesEmpty.classList.add('hidden');
    pagesNoResults.classList.add('hidden');
    pagesTable.classList.add('hidden');
    return;
  }
  renderPagesTable();
}

linksBtn.addEventListener('click', () => {
  pagesModal.classList.remove('hidden');
  pagesSearch.value = '';
  pagesSearchTerm = '';
  void loadPages();
});

pagesClose.addEventListener('click', () => pagesModal.classList.add('hidden'));
pagesModal.addEventListener('click', (e) => {
  if (e.target === pagesModal) pagesModal.classList.add('hidden');
});

pagesSearch.addEventListener('input', () => {
  pagesSearchTerm = pagesSearch.value;
  renderPagesTable();
});

pagesExport.addEventListener('click', () => {
  void bdo
    .exportPagesCsv()
    .then((csv) => {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().split('T')[0];
      a.download = `bdo-pages-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch((e) => {
      addErrorMessage(e instanceof Error ? e.message : String(e));
    });
});

// ============================================================================
// Toast de progreso de scrape
// ============================================================================

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
  resetToast(t('scrape.title'));
  appendToastLine(t('scrape.launching'), 'info');
  void bdo.startScrape().catch((e) => {
    appendToastLine(t('scrape.errorLaunching', { msg: e instanceof Error ? e.message : String(e) }), 'error');
    scrapeRunning = false;
    scrapeBtn.disabled = false;
  });
});

toastCancel.addEventListener('click', () => {
  if (!scrapeRunning) {
    closeToast();
    return;
  }
  toastCancel.disabled = true;
  toastCancel.textContent = t('scrape.cancelling');
  appendToastLine(t('scrape.cancellingLine'), 'warn');
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
  toastTitle.textContent = t('scrape.done');
  appendToastLine(t('scrape.pagesScraped', { count: p.pages }), 'done');
  if (p.bySite && Object.keys(p.bySite).length > 0) {
    const breakdown = Object.entries(p.bySite)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    appendToastLine(t('scrape.bySite', { breakdown }), 'done');
  }
  appendToastLine(t('scrape.totalChunks', { total: p.index.totalChunks, added: p.index.newChunks }), 'done');
  toastCancel.textContent = t('scrape.close');
  toastCancel.disabled = false;
  scrapeRunning = false;
});

bdo.onScrapeError((msg) => {
  toastTitle.textContent = t('scrape.error');
  appendToastLine(msg, 'error');
  toastCancel.textContent = t('scrape.close');
  toastCancel.disabled = false;
  scrapeRunning = false;
  scrapeBtn.disabled = false;
});

bdo.onScrapeCancelled(() => {
  toastTitle.textContent = t('scrape.cancelled');
  appendToastLine(t('scrape.cancelLine'), 'warn');
  toastCancel.textContent = t('scrape.close');
  toastCancel.disabled = false;
  scrapeRunning = false;
  scrapeBtn.disabled = false;
});

// ============================================================================
// Wallpaper de fondo
// ============================================================================

void bdo.getWallpaper().then((dataUrl) => {
  if (dataUrl) {
    const layer = document.getElementById('bg-layer');
    if (layer) layer.style.backgroundImage = `url("${dataUrl}")`;
  }
});

// ============================================================================
// Init
// ============================================================================

applyTranslations();
inputEl.focus();