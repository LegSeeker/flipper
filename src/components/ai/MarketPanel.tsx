import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ExternalLink, Plus, RefreshCw, Rss, Search, Sparkles, Trash2 } from 'lucide-react';
import { db } from '@/db/db';
import { addComps, clearComps, deleteComp, updateItem } from '@/db/repo';
import type { Item } from '@/db/schema';
import { useApp, useAiContext, useFormat } from '@/app/context';
import { refreshItemPrice, WEB_COMP_SOURCE } from '@/ai/refresh';
import { researchItem, type PriceResult } from '@/ai/tasks';
import { hostOf, searchEnabled } from '@/ai/client';
import { ownerImagesForAi } from '@/ai/images';
import { ebayResultsToComps, searchEbay } from '@/integrations/ebay';
import { feedToComps, fetchFeed } from '@/integrations/feeds';
import { hasProxy } from '@/integrations/proxy';
import { researchLinks, searchQuery } from '@/lib/marketplaces';
import { round2 } from '@/lib/money';
import { relativeTime } from '@/lib/dates';
import { errorMessage, median } from '@/lib/utils';
import { Markdown } from '@/lib/markdown';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyField } from '@/components/ui/field';
import { Modal } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/field';
import {
  AiDisclaimer,
  AiErrorText,
  AiNotConfigured,
  DataBasis,
  SourceList,
  TypingDots,
  useAiJob,
  useAiStream,
} from './common';

export function MarketPanel({ item }: { item: Item }) {
  const { settings, local } = useApp();
  const ai = useAiContext();
  const f = useFormat();
  const comps = useLiveQuery(() => db.comps.where('itemId').equals(item.id).toArray(), [item.id]);
  const [query, setQuery] = useState(searchQuery(item));
  const [compOpen, setCompOpen] = useState(false);
  const [fetching, setFetching] = useState('');
  const price = useAiJob<PriceResult>();
  const research = useAiStream();
  const proxy = { proxyUrl: settings.proxyUrl, proxyToken: local.proxyToken };
  const links = researchLinks(query, settings);
  const feeds = settings.marketplaces.filter((m) => m.enabled && m.feedUrl);

  const soldPrices = (comps ?? []).filter((c) => c.sold).map((c) => c.price);
  const activePrices = (comps ?? []).filter((c) => !c.sold).map((c) => c.price);

  const runPrice = () =>
    price
      .run((signal) => refreshItemPrice(item, { settings, local, ctx: ai, useEbay: hasProxy(proxy), signal }))
      .then((r) => {
        if (r)
          toast.success(
            `Estimated value updated: ${f.money(r.suggestedPrice)}${r.basis === 'live' ? ' (live data)' : ' (estimate)'}`,
          );
      });

  const runResearch = () =>
    research.start(async function* (signal) {
      const images = await ownerImagesForAi(ai.cfg, 'item', item.id, 3);
      yield* researchItem(ai, { ...item, name: query || item.name }, signal, images);
    });

  const fetchEbay = async () => {
    setFetching('ebay');
    try {
      const results = await searchEbay(proxy, query, settings.ebayMarketplaceId, {
        usedOnly: item.condition !== 'new',
      });
      await clearComps(item.id, 'eBay');
      await addComps(ebayResultsToComps(item.id, results));
      toast.success(`${results.length} eBay listings added`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setFetching('');
    }
  };

  const fetchCustom = async (id: string) => {
    const m = settings.marketplaces.find((x) => x.id === id);
    if (!m) return;
    setFetching(id);
    try {
      const entries = await fetchFeed(proxy, m.feedUrl, query, settings.city);
      const list = feedToComps(item.id, m.name, settings.currency, entries);
      await clearComps(item.id, m.name);
      await addComps(list);
      toast.success(`${list.length} results from ${m.name}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setFetching('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Current valuation */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs text-muted">Estimated value{item.quantity > 1 ? ' (unit)' : ''}</div>
          <div className="tabular mt-1 text-lg font-semibold">{f.money(item.estimatedValue)}</div>
          {item.marketLow !== null && item.marketHigh !== null && (
            <div className="tabular text-xs text-subtle">
              Range {f.money(item.marketLow)} – {f.money(item.marketHigh)}
            </div>
          )}
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs text-muted">Comparables</div>
          <div className="tabular mt-1 text-sm">
            Sold median: <b>{f.money(median(soldPrices))}</b>
          </div>
          <div className="tabular text-sm">
            Asking median: <b>{f.money(median(activePrices))}</b>
          </div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-xs text-muted">Last checked</div>
          <div className="mt-1 text-sm">
            {item.marketCheckedAt ? relativeTime(item.marketCheckedAt, f.locale) : 'Never'}
          </div>
          {ai.configured ? (
            <Button
              size="sm"
              variant="primary"
              className="mt-2"
              onClick={runPrice}
              loading={price.loading}
              icon={<RefreshCw className="size-3.5" />}
            >
              AI price check
            </Button>
          ) : null}
        </div>
      </div>
      {!ai.configured && <AiNotConfigured compact />}
      <AiErrorText message={price.error} />
      {price.result && (
        <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <DataBasis
              searched={price.result.searched}
              sources={price.result.sources}
              basis={price.result.basis}
            />
            <Badge tone="accent">List at {f.money(price.result.suggestedPrice)}</Badge>
            {price.result.quickSalePrice ? (
              <Badge tone="info">Quick sale {f.money(price.result.quickSalePrice)}</Badge>
            ) : null}
            <Badge>Confidence: {price.result.confidence}</Badge>
            <Badge>Demand: {price.result.demand}</Badge>
          </div>
          <p className="text-muted">{price.result.reasoning}</p>
          {price.result.bestPlatforms.length > 0 && (
            <p className="text-muted">Best platforms: {price.result.bestPlatforms.join(', ')}</p>
          )}
          {price.result.tips.length > 0 && (
            <ul className="list-disc pl-5 text-muted">
              {price.result.tips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          {price.result.webComps.length > 0 && (
            <p className="text-xs text-subtle">
              {price.result.webComps.length} listings found online were added to Comparables below.
            </p>
          )}
          <SourceList sources={price.result.sources} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                updateItem(item.id, { listPrice: round2(price.result!.suggestedPrice) }).then(() =>
                  toast.success('List price set'),
                )
              }
            >
              Use as list price
            </Button>
          </div>
          <AiDisclaimer />
        </div>
      )}
      {item.marketNotes && !price.result && (
        <p className="text-sm whitespace-pre-line text-muted">{item.marketNotes}</p>
      )}

      {/* Research links */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Research</h3>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            aria-label="Search terms"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium hover:border-accent/50"
            >
              {l.name}
              <ExternalLink className="size-3 text-subtle" />
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {hasProxy(proxy) && (
            <Button
              size="sm"
              onClick={fetchEbay}
              loading={fetching === 'ebay'}
              icon={<RefreshCw className="size-3.5" />}
            >
              Fetch eBay listings
            </Button>
          )}
          {hasProxy(proxy) &&
            feeds.map((m) => (
              <Button
                key={m.id}
                size="sm"
                onClick={() => fetchCustom(m.id)}
                loading={fetching === m.id}
                icon={<Rss className="size-3.5" />}
              >
                {m.name} feed
              </Button>
            ))}
          {ai.configured && (
            <Button
              size="sm"
              onClick={runResearch}
              loading={research.loading}
              icon={<Sparkles className="size-3.5" />}
            >
              AI research
            </Button>
          )}
        </div>
        {!hasProxy(proxy) && !searchEnabled(ai.cfg) && (
          <p className="text-xs text-subtle">
            Tip: turn on web search (Settings → AI, with Claude, Gemini or DeepSeek) or deploy the optional
            proxy (Settings → Marketplaces) so pricing uses live listings instead of estimates.
          </p>
        )}
        <AiErrorText message={research.error} />
        {(research.text || research.loading) && (
          <div className="space-y-3 rounded-xl border border-border bg-surface-2/50 p-3 text-sm text-muted">
            {research.text && <Markdown text={research.text} />}
            {research.loading && (!research.text || research.status) && (
              <TypingDots label={research.status || 'Researching…'} />
            )}
            {!research.loading && research.text && (
              <div className="space-y-2 border-t border-border pt-2">
                <DataBasis searched={research.searched} sources={research.sources} />
                <SourceList sources={research.sources} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Comparables */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Comparables ({comps?.length ?? 0})</h3>
          <div className="flex gap-1">
            {!!comps?.length && (
              <Button size="sm" variant="ghost" onClick={() => clearComps(item.id)}>
                Clear
              </Button>
            )}
            <Button size="sm" onClick={() => setCompOpen(true)} icon={<Plus className="size-3.5" />}>
              Add
            </Button>
          </div>
        </div>
        {comps?.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {[...comps]
              .sort((a, b) => Number(b.sold) - Number(a.sold) || a.price - b.price)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Badge tone={c.sold ? 'profit' : 'neutral'}>{c.sold ? 'Sold' : 'Asking'}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="hover:text-accent"
                        >
                          {c.title}
                        </a>
                      ) : (
                        c.title
                      )}
                    </div>
                    <div className="text-xs text-subtle">
                      {c.source === WEB_COMP_SOURCE && c.url ? `Web · ${hostOf(c.url)}` : c.source}
                      {c.condition && ` · ${c.condition}`}
                      {c.date && ` · ${f.date(c.date)}`}
                    </div>
                  </div>
                  <span className="tabular">
                    {c.currency && c.currency !== settings.currency
                      ? `${c.price} ${c.currency}`
                      : f.money(c.price)}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove comparable"
                    onClick={() => deleteComp(c.id)}
                    className="text-subtle hover:text-loss"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-subtle">
            Add sold prices you find while researching — they make AI pricing far more accurate.
          </p>
        )}
      </div>

      <AddCompDialog open={compOpen} onClose={() => setCompOpen(false)} itemId={item.id} />
    </div>
  );
}

function AddCompDialog({ open, onClose, itemId }: { open: boolean; onClose: () => void; itemId: string }) {
  const { settings } = useApp();
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [sold, setSold] = useState(true);
  const [source, setSource] = useState('eBay');
  const [url, setUrl] = useState('');

  const save = async () => {
    if (price === null) return toast.error('Enter a price');
    await addComps([
      {
        itemId,
        title: title || 'Comparable',
        price,
        currency: settings.currency,
        source,
        url,
        sold,
        condition: '',
        date: new Date().toISOString().slice(0, 10),
      },
    ]);
    setTitle('');
    setPrice(null);
    setUrl('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add comparable"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Add
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What you found"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Price" value={price} onChange={setPrice} />
          <Field label="Source">
            <Input value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
        </div>
        <Field label="Link (optional)">
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Checkbox checked={sold} onChange={setSold} label="This actually sold (not just listed)" />
      </div>
    </Modal>
  );
}
