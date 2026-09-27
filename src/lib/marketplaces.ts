import type { Item, MarketplaceLink, Settings } from '@/db/schema';

/** Search terms for an item: brand + model if present, otherwise its name. */
export function searchQuery(item: Pick<Item, 'name' | 'brand' | 'model'>): string {
  const bm = [item.brand, item.model].filter(Boolean).join(' ').trim();
  if (bm && !item.name.toLowerCase().includes(bm.toLowerCase())) return `${bm} ${item.name}`.trim();
  return (item.name || bm).trim();
}

function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function buildMarketplaceUrl(template: string, query: string, city: string): string {
  const citySlug = slug(city);
  let url = template;
  if (!citySlug) {
    // Drop the location segment rather than leaving an empty path/host part.
    url = url.replace('/{city}/', '/').replace('{city}.', '');
  }
  return url
    .replaceAll('{city}', encodeURIComponent(citySlug))
    .replaceAll('{query}', encodeURIComponent(query));
}

export interface ResearchLink {
  id: string;
  name: string;
  url: string;
  kind: 'search' | 'sold';
}

export function researchLinks(
  query: string,
  settings: Pick<Settings, 'marketplaces' | 'city' | 'facebookLocation'>,
): ResearchLink[] {
  const out: ResearchLink[] = [];
  for (const m of settings.marketplaces.filter((x: MarketplaceLink) => x.enabled)) {
    const city = m.id === 'facebook' && settings.facebookLocation ? settings.facebookLocation : settings.city;
    if (m.searchUrl)
      out.push({
        id: m.id,
        name: m.name,
        url: buildMarketplaceUrl(m.searchUrl, query, city),
        kind: 'search',
      });
    if (m.soldUrl)
      out.push({
        id: `${m.id}-sold`,
        name: `${m.name} sold`,
        url: buildMarketplaceUrl(m.soldUrl, query, city),
        kind: 'sold',
      });
  }
  return out;
}
