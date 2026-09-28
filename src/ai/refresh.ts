/**
 * Market pricing refresh: optionally pull fresh eBay comparables through the
 * proxy, then ask the AI for a price (searching the web when the provider can)
 * and store it on the item, together with any listings it found.
 */
import { db } from '@/db/db';
import { addComps, clearComps, updateItem } from '@/db/repo';
import type { Item, LocalSettings, Settings } from '@/db/schema';
import { ebayResultsToComps, searchEbay } from '@/integrations/ebay';
import { hasProxy } from '@/integrations/proxy';
import { searchQuery } from '@/lib/marketplaces';
import { round2 } from '@/lib/money';
import { errorMessage } from '@/lib/utils';
import { searchEnabled } from './client';
import { ownerImagesForAi } from './images';
import { estimatePrice, type AiContext, type PriceResult } from './tasks';

/** Comparable source used for listings the AI found on the web. */
export const WEB_COMP_SOURCE = 'Web search';

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
  // With web search on, earlier web finds are replaced rather than fed back in, so stale
  // listings don't anchor the new estimate. Without search they are the best data we have.
  const searching = searchEnabled(opts.ctx.cfg);
  const comps = (await db.comps.where('itemId').equals(item.id).toArray()).filter(
    (c) => !searching || c.source !== WEB_COMP_SOURCE,
  );
  const images = await ownerImagesForAi(opts.ctx.cfg, 'item', item.id, 3);
  const res = await estimatePrice(opts.ctx, item, comps, opts.signal, images);
  if (res.webComps.length) {
    await clearComps(item.id, WEB_COMP_SOURCE);
    const date = new Date().toISOString().slice(0, 10);
    await addComps(
      res.webComps.map((c) => ({
        itemId: item.id,
        title: c.title || c.source || 'Web listing',
        price: round2(c.price),
        currency: opts.settings.currency,
        source: WEB_COMP_SOURCE,
        url: c.url,
        sold: c.sold,
        condition: '',
        date,
      })),
    );
  }
  await updateItem(item.id, {
    estimatedValue: round2(res.suggestedPrice),
    marketLow: res.low !== null && res.low !== undefined ? round2(res.low) : null,
    marketHigh: res.high !== null && res.high !== undefined ? round2(res.high) : null,
    marketCheckedAt: Date.now(),
    marketNotes: marketNote(res),
  });
  return res;
}

export function marketNote(res: PriceResult): string {
  const basis =
    res.basis === 'live'
      ? `Based on live market data${res.sources.length ? ` (${res.sources.length} web sources)` : ''}.`
      : 'Estimate — no live market data was used.';
  return `${basis} ${res.reasoning}${res.quickSalePrice ? `\nQuick sale: ${res.quickSalePrice}` : ''} (confidence: ${res.confidence}, demand: ${res.demand})`;
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
