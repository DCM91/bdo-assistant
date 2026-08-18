import { chromium, type Browser, type Page } from 'playwright';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { config } from './config';
import { slugify } from './chunker';
import type { ScrapedPage, SiteId } from './types';

const DATA_DIR = config.paths.scrapedDir;
const PROFILE_DIR = config.paths.profileDir;

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const { chromePath: CHROME_PATH, cdpPort: CDP_PORT, delayMs: DELAY_MS, sites: SITES } =
  config.scraper;

/**
 * Referencia al Chrome que hemos lanzado nosotros. La conservamos para matarlo
 * por PID; nunca usamos `taskkill /IM chrome.exe` porque cierra el navegador
 * personal del usuario y el de cualquier otra herramienta del sistema.
 */
let chromeProc: ChildProcess | null = null;

function killChrome(): void {
  const proc = chromeProc;
  chromeProc = null;
  if (!proc || proc.pid === undefined) return;
  if (proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    /* ya estaba muerto */
  }
}

/** Sitio a scrapear (espejo de config.scraper.sites con tipos). */
interface Site {
  id: SiteId;
  baseUrl: string;
  startUrls: readonly string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Normaliza una URL para deduplicación:
 * - sin fragmento
 * - host en minúsculas y sin 'www.'
 * - sin parámetros de tracking
 * - sin trailing slash (excepto la raíz)
 */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.host = u.host.toLowerCase().replace(/^www\./, '');
    const tracking = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
    tracking.forEach((p) => u.searchParams.delete(p));
    let p = u.pathname;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    u.pathname = p;
    return u.toString();
  } catch {
    return url;
  }
}

function extractLinks($: cheerio.CheerioAPI, currentUrl: string, baseUrl: string): string[] {
  const links: string[] = [];
  const baseOrigin = new URL(baseUrl).origin;
  const basePrefix = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
    try {
      const absolute = new URL(href, currentUrl).href;
      if (absolute !== currentUrl && new URL(absolute).origin === baseOrigin && absolute.startsWith(basePrefix)) {
        links.push(canonicalUrl(absolute));
      }
    } catch {
      /* ignore malformed */
    }
  });
  return [...new Set(links)];
}

function launchChrome(): ChildProcess {
  // Liberar el lock del perfil si nuestro Chrome anterior quedó vivo por una
  // cancelación previa (matamos por PID local, no por nombre de imagen).
  killChrome();

  if (!existsSync(CHROME_PATH)) {
    throw new Error(`Chrome no encontrado en ${CHROME_PATH}. Ajusta config.scraper.chromePath.`);
  }

  const proc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  );

  proc.on('error', (e) => {
    console.error(`[scraper] Chrome (pid=${proc.pid}) error: ${e.message}`);
  });

  chromeProc = proc;
  return proc;
}

async function connectToChrome(): Promise<Browser> {
  for (let i = 0; i < 20; i++) {
    try {
      const response = await fetch(`http://localhost:${CDP_PORT}/json/version`);
      if (response.ok) {
        return await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
      }
    } catch {
      /* not ready yet */
    }
    await sleep(1000);
  }
  throw new Error('No se pudo conectar a Chrome. Asegúrate de tener Chrome instalado.');
}

interface ScrapePageResult {
  result: ScrapedPage;
  links: string[];
}

async function scrapePage(
  page: Page,
  url: string,
  site: Site,
  firstPage = false,
): Promise<ScrapePageResult | null> {
  console.log(`  [${site.id}] Scrapeando: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    if (firstPage) {
      try {
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await btn.textContent();
          if (text && (text.includes('ACEPTO') || text.includes('Accept') || text.includes('AGREE'))) {
            await btn.click();
            await page.waitForTimeout(2000);
            break;
          }
        }
      } catch {
        /* cookie dialog might be different */
      }
    }

    let html = await page.content();

    if (html.includes('Attention Required') || html.includes('Just a moment') || html.length < 3000) {
      await page.waitForTimeout(5000);
      const retryHtml = await page.content();
      if (retryHtml.includes('Attention Required') || retryHtml.includes('Just a moment') || retryHtml.length < 3000) {
        console.log(`    ✗ [${site.id}] Cloudflare bloquea esta página`);
        return null;
      }
      html = retryHtml;
    }

    const $ = cheerio.load(html);
    $('script, style, noscript, nav, footer, header, .nav, .footer, .header, [role="navigation"]').remove();

    const title = $('title').text().trim() || url;
    const h1 = $('h1').first().text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';

    let bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 50000);

    if (bodyText.length < 80) {
      await page.waitForTimeout(4000);
      const $2 = cheerio.load(await page.content());
      $2('script, style, noscript, nav, footer, header').remove();
      bodyText = $2('body').text().replace(/\s+/g, ' ').trim().substring(0, 50000);
    }

    const links = extractLinks($, url, site.baseUrl);

    const result: ScrapedPage = {
      url,
      title: h1 || title,
      meta_description: metaDesc,
      text: bodyText,
      scraped_at: new Date().toISOString(),
      internal_links: links,
      site_id: site.id,
    };

    // Prefijo por sitio para evitar colisiones (ej: garmoth__index.json vs bdo__index.json)
    const filename = `${site.id}__${slugify(url)}.json`;
    const finalPath = path.join(DATA_DIR, filename);
    const tmpPath = `${finalPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(result, null, 2), 'utf-8');
    renameSync(tmpPath, finalPath);

    console.log(`    ✓ [${site.id}] ${bodyText.length} chars, ${links.length} links`);
    return { result, links };
  } catch (e) {
    console.log(`    ✗ [${site.id}] Error: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export interface ScrapeOptions {
  maxPages?: number;
}

export interface ScrapeResult {
  pages: number;
  bySite: Record<string, number>;
}

async function scrapeSite(
  page: Page,
  site: Site,
  maxPages: number,
): Promise<{ scraped: number }> {
  const visited = new Set<string>();
  const toVisit = site.startUrls.map((u) => canonicalUrl(site.baseUrl + u));
  let scraped = 0;
  let isFirst = true;

  while (toVisit.length > 0 && scraped < maxPages) {
    const url = toVisit.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const pageResult = await scrapePage(page, url, site, isFirst);
    isFirst = false;
    if (pageResult) {
      scraped++;
      for (const link of pageResult.links) {
        if (!visited.has(link) && toVisit.length < maxPages * 2) {
          toVisit.push(link);
        }
      }
    }

    if (toVisit.length > 0 && scraped < maxPages) {
      console.log(`  ⏳ [${site.id}] Esperando ${DELAY_MS / 1000}s...`);
      await sleep(DELAY_MS);
    }
  }

  return { scraped };
}

export async function scrape(options: ScrapeOptions = {}): Promise<ScrapeResult> {
  const { maxPages = config.scraper.maxPages } = options;

  console.log('🚀 Iniciando scraper multi-sitio...');
  console.log(`   Sitios configurados: ${SITES.map((s) => s.id).join(', ')}`);
  console.log(`   Tope por sitio: ${maxPages} páginas`);
  console.log('   (Se abrirá Chrome para evadir Cloudflare)\n');

  let context: Browser | null = null;

  try {
    launchChrome();
    await sleep(3000);

    context = await connectToChrome();
    const page = await context.newPage();

    const bySite: Record<string, number> = {};
    let total = 0;

    for (const site of SITES as readonly Site[]) {
      console.log(`\n📡 [${site.id}] ${site.baseUrl}`);
      const { scraped } = await scrapeSite(page, site, maxPages);
      bySite[site.id] = scraped;
      total += scraped;
      console.log(`   [${site.id}] ${scraped} páginas scrapeadas`);
    }

    const breakdown = Object.entries(bySite).map(([k, v]) => `${k}: ${v}`).join(', ');
    console.log(`\n✅ Scrape completado: ${total} páginas (${breakdown})`);
    return { pages: total, bySite };
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (e) {
        console.error(`[scraper] Error cerrando el navegador: ${e instanceof Error ? e.message : e}`);
      }
    }
    killChrome();
  }
}

if (require.main === module) {
  const idx = process.argv.indexOf('--max-pages');
  const maxPages = idx > -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : config.scraper.maxPages;
  scrape({ maxPages }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
