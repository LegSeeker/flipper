import type { Dataset, Ledger } from '@/lib/calc';
import { ACTIVE_ITEM_STATUSES } from '@/db/schema';
import { buildReport } from '@/lib/stats';
import { periodRange } from '@/lib/dates';

/** Compact, token-cheap summary of the user's business for the assistant. */
export function businessSummary(ds: Dataset, ledger: Ledger, currency: string): string {
  const r = buildReport(ds, ledger, periodRange('12m'));
  const active = ds.items.filter((i) => !i.archived && ACTIVE_ITEM_STATUSES.includes(i.status));
  const byCat = new Map<string, number>();
  for (const i of active)
    byCat.set(i.category || 'Uncategorised', (byCat.get(i.category || 'Uncategorised') ?? 0) + 1);
  const recentSales = [...ds.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const items = new Map(ds.items.map((i) => [i.id, i]));
  const lines = [
    `Currency: ${currency}`,
    `Last 12 months: revenue ${r.revenue}, net profit ${r.netProfit}, ${r.salesCount} sales, avg days to sell ${r.avgDaysToSell ?? 'n/a'}.`,
    r.byCategory.length
      ? `Profit by category (12m): ${r.byCategory
          .slice(0, 8)
          .map((b) => `${b.name} ${b.profit} from ${b.units} sold`)
          .join('; ')}`
      : '',
    r.byPlatform.length
      ? `Platforms (12m): ${r.byPlatform.map((b) => `${b.name} ${b.revenue}`).join('; ')}`
      : '',
    `Active stock: ${active.length} items (${[...byCat.entries()].map(([c, n]) => `${c} ${n}`).join(', ')})`,
    active.length
      ? `Some active items: ${active
          .slice(0, 15)
          .map(
            (i) =>
              `${i.name} [${i.status}, cost ${ledger.items.get(i.id)?.costBasis ?? 0}${i.listPrice ? `, listed ${i.listPrice}` : ''}]`,
          )
          .join('; ')}`
      : '',
    recentSales.length
      ? `Recent sales: ${recentSales
          .map((s) => {
            const it = items.get(s.itemId);
            return `${it?.name ?? 'item'} for ${s.price}`;
          })
          .join('; ')}`
      : '',
    ds.projects.length
      ? `Projects: ${ds.projects
          .filter((p) => !p.archived)
          .slice(0, 10)
          .map((p) => `${p.name} (${p.type}, ${p.status})`)
          .join('; ')}`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}
