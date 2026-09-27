/**
 * Custom marketplace feeds: RSS, Atom or JSON (array or {items: [...]}) fetched
 * through the proxy. Prices are read from explicit fields or guessed from text.
 */
import type { Comp } from '@/db/schema';
import { parseNumber } from '@/lib/utils';
import { buildMarketplaceUrl } from '@/lib/marketplaces';
import { proxyFetch, type ProxyConfig } from './proxy';

export interface FeedEntry {
  title: string;
  url: string;
  price: number | null;
  date: string | null;
}

const PRICE_RE =
  /(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD|PLN|CHF)\s?(\d[\d\s.,]*)|(\d[\d\s.,]*)\s?(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD|PLN|CHF|zł|kr)/i;

export function guessPrice(text: string): number | null {
  const m = PRICE_RE.exec(text);
  if (!m) return null;
  return parseNumber(m[1] ?? m[2] ?? '');
}

export function parseFeed(text: string): FeedEntry[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed);
    const list: unknown[] = Array.isArray(data) ? data : (data.items ?? data.results ?? data.data ?? []);
    return list.slice(0, 100).map((raw) => {
      const r = raw as Record<string, unknown>;
      const title = String(r.title ?? r.name ?? '');
      const priceField = r.price ?? (r.price_value as unknown) ?? (r.amount as unknown);
      const price =
        typeof priceField === 'number'
          ? priceField
          : typeof priceField === 'object' && priceField
            ? parseNumber(String((priceField as Record<string, unknown>).value ?? ''))
            : priceField
              ? parseNumber(String(priceField))
              : guessPrice(`${title} ${String(r.description ?? '')}`);
      return {
        title,
        url: String(r.url ?? r.link ?? ''),
        price,
        date: r.date ? String(r.date).slice(0, 10) : null,
      };
    });
  }
  const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('The feed is not valid RSS/Atom/JSON.');
  const nodes = [...doc.querySelectorAll('item, entry')].slice(0, 100);
  return nodes.map((n) => {
    const title = n.querySelector('title')?.textContent?.trim() ?? '';
    const linkEl = n.querySelector('link');
    const url = linkEl?.getAttribute('href') ?? linkEl?.textContent?.trim() ?? '';
    const desc = n.querySelector('description, summary, content')?.textContent ?? '';
    const priceEl = n.querySelector('price, g\\:price');
    const price = priceEl?.textContent ? parseNumber(priceEl.textContent) : guessPrice(`${title} ${desc}`);
    const dateText = n.querySelector('pubDate, published, updated')?.textContent;
    let date: string | null = null;
    if (dateText) {
      const d = new Date(dateText);
      if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    return { title, url, price, date };
  });
}

export async function fetchFeed(
  cfg: ProxyConfig,
  template: string,
  query: string,
  city: string,
): Promise<FeedEntry[]> {
  const url = buildMarketplaceUrl(template, query, city);
  const res = await proxyFetch(cfg, `/fetch?url=${encodeURIComponent(url)}`);
  return parseFeed(await res.text());
}

export function feedToComps(
  itemId: string,
  source: string,
  currency: string,
  entries: FeedEntry[],
): Omit<Comp, 'id' | 'createdAt' | 'updatedAt'>[] {
  return entries
    .filter((e) => e.price !== null && e.price > 0)
    .map((e) => ({
      itemId,
      title: e.title,
      price: e.price!,
      currency,
      source,
      url: e.url,
      sold: false,
      condition: '',
      date: e.date,
    }));
}
