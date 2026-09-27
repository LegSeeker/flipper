import type { Comp } from '@/db/schema';
import { proxyFetch, type ProxyConfig } from './proxy';

export interface EbayResult {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  condition: string;
  image: string;
}

/**
 * Search active eBay listings via the Browse API (through the proxy).
 * Note: eBay only exposes *sold* prices through a restricted API, so these are
 * asking prices — use the "sold" research link to check what actually sold.
 */
export async function searchEbay(
  cfg: ProxyConfig,
  query: string,
  marketplaceId: string,
  opts: { limit?: number; usedOnly?: boolean } = {},
): Promise<EbayResult[]> {
  const params = new URLSearchParams({
    q: query,
    marketplace: marketplaceId,
    limit: String(opts.limit ?? 25),
  });
  if (opts.usedOnly) params.set('used', '1');
  const res = await proxyFetch(cfg, `/ebay/search?${params}`);
  const data = (await res.json()) as { items?: EbayResult[] };
  return (data.items ?? []).filter((r) => Number.isFinite(r.price) && r.price > 0);
}

export function ebayResultsToComps(
  itemId: string,
  results: EbayResult[],
): Omit<Comp, 'id' | 'createdAt' | 'updatedAt'>[] {
  return results.map((r) => ({
    itemId,
    title: r.title,
    price: r.price,
    currency: r.currency,
    source: 'eBay',
    url: r.url,
    sold: false,
    condition: r.condition,
    date: null,
  }));
}
