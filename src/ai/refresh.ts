/**
 * Market pricing refresh: optionally pull fresh eBay comparables through the
 * proxy, then ask the AI for a price and store it on the item.
 */
import { db } from '@/db/db';
import { addComps, clearComps, updateItem } from '@/db/repo';
import type { Item, LocalSettings, Settings } from '@/db/schema';
import { ebayResultsToComps, searchEbay } from '@/integrations/ebay';
import { hasProxy } from '@/integrations/proxy';
import { searchQuery } from '@/lib/marketplaces';
import { round2 } from '@/lib/money';
import { errorMessage } from '@/lib/utils';
import { estimatePrice, type AiContext, type PriceResult } from './tasks';

export interface RefreshOptions {
  settings: Settings;
  local: LocalSettings;
  ctx: AiContext;
  useEbay: boolean;
  signal?: AbortSignal;
}

export async function refreshItemPrice(item: Item, opts: RefreshOptions): Promise<PriceResult> {
  const proxy = { proxyUrl: opts.settings.proxyUrl, proxyToken: opts.local.proxyToken };
  if (opts.useEbay && hasProxy(proxy)) {
    try {
      const results = await searchEbay(proxy, searchQuery(item), opts.settings.ebayMarketplaceId, {
        limit: 20,
        usedOnly: item.condition !== 'new',
      });
      await clearComps(item.id, 'eBay');
      await addComps(ebayResultsToComps(item.id, results));
    } catch {
      /* fall back to whatever comps we already have */
    }
  }
  const comps = await db.comps.where('itemId').equals(item.id).toArray();
  const res = await estimatePrice(opts.ctx, item, comps, opts.signal);
  await updateItem(item.id, {
    estimatedValue: round2(res.suggestedPrice),
    marketLow: res.low !== null && res.low !== undefined ? round2(res.low) : null,
    marketHigh: res.high !== null && res.high !== undefined ? round2(res.high) : null,
    marketCheckedAt: Date.now(),
    marketNotes: `${res.reasoning}${res.quickSalePrice ? `\nQuick sale: ${res.quickSalePrice}` : ''} (confidence: ${res.confidence}, demand: ${res.demand})`,
  });
  return res;
}

export interface BulkProgress {
  done: number;
  total: number;
  current: string;
  errors: string[];
}

/** Refresh several items one at a time (keeps within provider rate limits). */
export async function refreshMany(
  items: Item[],
  opts: RefreshOptions,
  onProgress: (p: BulkProgress) => void,
): Promise<BulkProgress> {
  const p: BulkProgress = { done: 0, total: items.length, current: '', errors: [] };
  for (const item of items) {
    if (opts.signal?.aborted) break;
    p.current = item.name;
    onProgress({ ...p });
    try {
      await refreshItemPrice(item, opts);
    } catch (e) {
      p.errors.push(`${item.code} ${item.name}: ${errorMessage(e)}`);
      if (
        e instanceof Error &&
        'kind' in e &&
        ['auth', 'balance', 'no_key', 'config', 'aborted'].includes(String(e.kind))
      )
        break;
    }
    p.done++;
    onProgress({ ...p });
  }
  return p;
}
