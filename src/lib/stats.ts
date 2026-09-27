/**
 * Report aggregation over a date range. Profit here is on a cost-of-goods-sold
 * basis: each sale is matched with the unit cost of the item it came from, then
 * general (overhead) expenses and write-offs in the period are subtracted.
 */
import type { Item, Settings } from '@/db/schema';
import { ACTIVE_ITEM_STATUSES } from '@/db/schema';
import type { Dataset, Ledger } from './calc';
import { expectedUnitPrice, saleNet } from './calc';
import { daysBetween, inRange, monthKey, monthRange } from './dates';
import { round2 } from './money';
import { sum } from './utils';

export interface Breakdown {
  name: string;
  revenue: number;
  profit: number;
  units: number;
  count: number;
}

export interface MonthPoint {
  month: string;
  revenue: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

export interface Report {
  revenue: number;
  sellingCosts: number;
  cogs: number;
  grossProfit: number;
  generalExpenses: number;
  writeOffs: number;
  netProfit: number;
  margin: number | null;
  roi: number | null;
  salesCount: number;
  unitsSold: number;
  avgSale: number | null;
  avgProfitPerSale: number | null;
  avgDaysToSell: number | null;
  sellThrough: number | null;
  purchases: number;
  monthly: MonthPoint[];
  byCategory: Breakdown[];
  byPlatform: Breakdown[];
  byProjectType: Breakdown[];
  topItems: { item: Item; profit: number; revenue: number }[];
  worstItems: { item: Item; profit: number; revenue: number }[];
  expensesByCategory: { name: string; amount: number }[];
}

function bump(map: Map<string, Breakdown>, name: string, revenue: number, profit: number, units: number) {
  const b = map.get(name) ?? { name, revenue: 0, profit: 0, units: 0, count: 0 };
  b.revenue += revenue;
  b.profit += profit;
  b.units += units;
  b.count += 1;
  map.set(name, b);
}

function finalize(map: Map<string, Breakdown>): Breakdown[] {
  return [...map.values()]
    .map((b) => ({ ...b, revenue: round2(b.revenue), profit: round2(b.profit) }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function buildReport(
  ds: Dataset,
  ledger: Ledger,
  range: { from: string; to: string },
  platformName: (id: string) => string = (id) => id,
): Report {
  const itemsById = new Map(ds.items.map((i) => [i.id, i]));
  const projectsById = new Map(ds.projects.map((p) => [p.id, p]));
  const sales = ds.sales.filter((s) => inRange(s.date, range.from, range.to));

  const byCategory = new Map<string, Breakdown>();
  const byPlatform = new Map<string, Breakdown>();
  const byProjectType = new Map<string, Breakdown>();
  const perItem = new Map<string, { profit: number; revenue: number }>();

  const firstSale = ds.sales.length
    ? ds.sales.reduce((m, s) => (s.date < m ? s.date : m), ds.sales[0].date)
    : range.to;
  const effectiveFrom = range.from === '1970-01-01' ? firstSale : range.from;
  const effectiveTo = range.to === '9999-12-31' ? new Date().toISOString().slice(0, 10) : range.to;
  const months = new Map<string, MonthPoint>(
    monthRange(effectiveFrom, effectiveTo).map((m) => [
      m,
      { month: m, revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0 },
    ]),
  );

  let revenue = 0;
  let sellingCosts = 0;
  let cogs = 0;
  let unitsSold = 0;
  const daysToSell: number[] = [];

  for (const s of sales) {
    const item = itemsById.get(s.itemId);
    const fin = ledger.items.get(s.itemId);
    const n = saleNet(s);
    const saleCogs = (fin?.unitCost ?? 0) * s.quantity;
    const profit = n.net - saleCogs;
    revenue += n.revenue;
    sellingCosts += n.sellingCosts;
    cogs += saleCogs;
    unitsSold += s.quantity;
    if (item) {
      bump(byCategory, item.category || 'Uncategorised', n.revenue, profit, s.quantity);
      const project = item.projectId ? projectsById.get(item.projectId) : undefined;
      bump(byProjectType, project ? project.type : 'standalone', n.revenue, profit, s.quantity);
      const start = item.purchaseDate ?? new Date(item.createdAt);
      daysToSell.push(Math.max(0, daysBetween(start, s.date)));
      const pi = perItem.get(item.id) ?? { profit: 0, revenue: 0 };
      pi.profit += profit;
      pi.revenue += n.revenue;
      perItem.set(item.id, pi);
    }
    bump(byPlatform, platformName(s.platform) || 'Unknown', n.revenue, profit, s.quantity);
    const mp = months.get(monthKey(s.date));
    if (mp) {
      mp.revenue += n.revenue;
      mp.grossProfit += profit;
    }
  }

  const generalExpenses = ds.expenses.filter(
    (e) => e.ownerType === 'general' && inRange(e.date, range.from, range.to),
  );
  const expByCat = new Map<string, number>();
  for (const e of generalExpenses) {
    expByCat.set(e.category, (expByCat.get(e.category) ?? 0) + e.amount);
    const mp = months.get(monthKey(e.date));
    if (mp) mp.expenses += e.amount;
  }

  const writeOffItems = ds.items.filter(
    (i) => i.status === 'written_off' && inRange(i.finishedAt, range.from, range.to),
  );
  const writeOffs = sum(writeOffItems, (i) => {
    const f = ledger.items.get(i.id);
    return f ? f.unitCost * f.remainingQty : 0;
  });
  for (const i of writeOffItems) {
    const mp = i.finishedAt ? months.get(monthKey(i.finishedAt)) : undefined;
    const f = ledger.items.get(i.id);
    if (mp && f) mp.expenses += f.unitCost * f.remainingQty;
  }

  const purchases =
    sum(
      ds.items.filter((i) => inRange(i.purchaseDate, range.from, range.to)),
      (i) => i.purchasePrice + i.purchaseCosts,
    ) +
    sum(
      ds.projects.filter((p) => inRange(p.purchaseDate, range.from, range.to)),
      (p) => p.purchasePrice + p.purchaseCosts,
    );

  const grossProfit = revenue - sellingCosts - cogs;
  const genTotal = sum(generalExpenses, (e) => e.amount);
  const netProfit = grossProfit - genTotal - writeOffs;
  const inStockUnits = sum(
    ds.items.filter((i) => ACTIVE_ITEM_STATUSES.includes(i.status) && i.status !== 'sourcing' && !i.archived),
    (i) => ledger.items.get(i.id)?.remainingQty ?? 0,
  );

  const ranked = [...perItem.entries()]
    .map(([id, v]) => ({ item: itemsById.get(id)!, profit: round2(v.profit), revenue: round2(v.revenue) }))
    .sort((a, b) => b.profit - a.profit);

  return {
    revenue: round2(revenue),
    sellingCosts: round2(sellingCosts),
    cogs: round2(cogs),
    grossProfit: round2(grossProfit),
    generalExpenses: round2(genTotal),
    writeOffs: round2(writeOffs),
    netProfit: round2(netProfit),
    margin: revenue > 0 ? netProfit / revenue : null,
    roi: cogs > 0 ? grossProfit / cogs : null,
    salesCount: sales.length,
    unitsSold,
    avgSale: sales.length ? round2(revenue / sales.length) : null,
    avgProfitPerSale: sales.length ? round2(grossProfit / sales.length) : null,
    avgDaysToSell: daysToSell.length ? Math.round(sum(daysToSell, (d) => d) / daysToSell.length) : null,
    sellThrough: unitsSold + inStockUnits > 0 ? unitsSold / (unitsSold + inStockUnits) : null,
    purchases: round2(purchases),
    monthly: [...months.values()].map((m) => ({
      month: m.month,
      revenue: round2(m.revenue),
      grossProfit: round2(m.grossProfit),
      expenses: round2(m.expenses),
      netProfit: round2(m.grossProfit - m.expenses),
    })),
    byCategory: finalize(byCategory),
    byPlatform: finalize(byPlatform),
    byProjectType: finalize(byProjectType),
    topItems: ranked.filter((r) => r.profit > 0).slice(0, 5),
    worstItems: ranked
      .filter((r) => r.profit < 0)
      .slice(-5)
      .reverse(),
    expensesByCategory: [...expByCat.entries()]
      .map(([name, amount]) => ({ name, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

export interface InventorySnapshot {
  activeItems: number;
  units: number;
  costValue: number;
  estimatedValue: number;
  potentialProfit: number;
  listed: number;
  inRepair: number;
  sourcing: number;
  stale: Item[];
  missingPhotos: Item[];
  missingPrice: Item[];
  activeProjects: number;
}

export function inventorySnapshot(
  ds: Dataset,
  ledger: Ledger,
  settings: Pick<Settings, 'staleDays'>,
  imageOwnerIds: ReadonlySet<string>,
): InventorySnapshot {
  const active = ds.items.filter((i) => !i.archived && ACTIVE_ITEM_STATUSES.includes(i.status));
  const held = active.filter((i) => i.status !== 'sourcing');
  let units = 0;
  let costValue = 0;
  let estimatedValue = 0;
  for (const i of held) {
    const f = ledger.items.get(i.id);
    if (!f) continue;
    units += f.remainingQty;
    costValue += f.unitCost * f.remainingQty;
    estimatedValue += (expectedUnitPrice(i) ?? f.unitCost) * f.remainingQty;
  }
  const stale = active.filter(
    (i) => i.status === 'listed' && i.listedAt && daysBetween(i.listedAt) >= settings.staleDays,
  );
  return {
    activeItems: active.length,
    units,
    costValue: round2(costValue),
    estimatedValue: round2(estimatedValue),
    potentialProfit: round2(estimatedValue - costValue),
    listed: active.filter((i) => i.status === 'listed').length,
    inRepair: active.filter((i) => i.status === 'in_repair').length,
    sourcing: active.filter((i) => i.status === 'sourcing').length,
    stale,
    missingPhotos: held.filter((i) => !imageOwnerIds.has(i.id)),
    missingPrice: held.filter((i) => expectedUnitPrice(i) === null),
    activeProjects: ds.projects.filter((p) => !p.archived && p.status !== 'finished').length,
  };
}
