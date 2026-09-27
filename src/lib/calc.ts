/**
 * Profit / cost calculations. Pure functions — no DB access — so they are easy
 * to test and reuse on any page.
 *
 * Cost model:
 *  - Item cost basis = purchase price + acquisition costs + item expenses
 *    + actual cost of repair parts + its share of project costs.
 *  - Project "shared" costs (project purchase, project expenses, project parts)
 *    are spread across the project's items by relative value, equally per unit,
 *    or manually. This is what lets a part-out show per-part profit.
 *  - Realized profit only counts units that have sold (cost of goods sold).
 */
import type {
  AllocationMethod,
  Expense,
  ID,
  Item,
  ItemStatus,
  PlatformFee,
  Project,
  Requirement,
  Sale,
} from '@/db/schema';
import { ACTIVE_ITEM_STATUSES } from '@/db/schema';
import { round2 } from './money';
import { daysBetween } from './dates';
import { sum } from './utils';

export type FeeLike = Pick<PlatformFee, 'feePercent' | 'fixedFee'>;

/** Finished statuses that are not a sale outcome (no profit/loss is projected). */
const NO_RESULT_STATUSES: readonly ItemStatus[] = ['kept', 'consumed', 'parted_out'];

/** Items that don't take a share of project costs (a parted-out source's cost lives on the project). */
const EXCLUDED_FROM_ALLOCATION: readonly ItemStatus[] = ['parted_out'];

export interface SaleNet {
  revenue: number;
  sellingCosts: number;
  net: number;
}

export function saleNet(s: Sale): SaleNet {
  const revenue = s.price + s.shippingCharged;
  const sellingCosts = s.fees + s.shippingCost;
  return { revenue, sellingCosts, net: revenue - sellingCosts };
}

export function partsCost(reqs: readonly Requirement[]): number {
  return sum(reqs, (r) => r.actualCost ?? 0);
}

export function pendingPartsCost(reqs: readonly Requirement[]): number {
  return sum(
    reqs.filter((r) => r.status === 'needed' && !r.inventoryItemId),
    (r) => r.estimatedCost ?? 0,
  );
}

/** Per-unit value used for projections and value-based allocation. */
export function expectedUnitPrice(item: Pick<Item, 'listPrice' | 'estimatedValue'>): number | null {
  return item.listPrice ?? item.estimatedValue ?? null;
}

export interface ItemFinancials {
  purchase: number;
  allocated: number;
  expenses: number;
  parts: number;
  costBasis: number;
  unitCost: number;
  soldQty: number;
  remainingQty: number;
  revenue: number;
  sellingCosts: number;
  netProceeds: number;
  cogsSold: number;
  realizedProfit: number;
  margin: number | null;
  roi: number | null;
  projectedProfit: number | null;
  projectedMargin: number | null;
  daysToSell: number | null;
  daysHeld: number;
  pendingParts: number;
  firstSaleDate: string | null;
  lastSaleDate: string | null;
}

export interface ItemInputs {
  item: Item;
  sales?: readonly Sale[];
  expenses?: readonly Expense[];
  requirements?: readonly Requirement[];
  allocated?: number;
}

export function itemFinancials(
  { item, sales = [], expenses = [], requirements = [], allocated = 0 }: ItemInputs,
  fee?: FeeLike,
): ItemFinancials {
  const purchase = item.purchasePrice + item.purchaseCosts;
  const exp = sum(expenses, (e) => e.amount);
  const parts = partsCost(requirements);
  const costBasis = round2(purchase + allocated + exp + parts);
  const qty = Math.max(1, item.quantity);
  const unitCost = costBasis / qty;

  const soldQty = Math.min(
    qty,
    sum(sales, (s) => s.quantity),
  );
  const remainingQty = Math.max(0, qty - soldQty);
  const nets = sales.map(saleNet);
  const revenue = round2(sum(nets, (n) => n.revenue));
  const sellingCosts = round2(sum(nets, (n) => n.sellingCosts));
  const netProceeds = round2(revenue - sellingCosts);
  const cogsSold = round2(unitCost * soldQty);
  const realizedProfit = round2(netProceeds - cogsSold);

  const dates = sales.map((s) => s.date).sort();
  const firstSaleDate = dates[0] ?? null;
  const lastSaleDate = dates.at(-1) ?? null;
  const start = item.purchaseDate ?? new Date(item.createdAt);
  const daysToSell = firstSaleDate ? Math.max(0, daysBetween(start, firstSaleDate)) : null;
  const daysHeld = Math.max(0, daysBetween(start, item.finishedAt ?? new Date()));

  let projectedProfit: number | null = null;
  let projectedMargin: number | null = null;
  const isActive = ACTIVE_ITEM_STATUSES.includes(item.status);
  const unitPrice = expectedUnitPrice(item);
  if (NO_RESULT_STATUSES.includes(item.status) && soldQty === 0) {
    // Kept for personal use, used as a part, or broken down: no sale outcome to project.
  } else if (remainingQty === 0 || !isActive) {
    // Nothing left to sell: the final result is proceeds minus the full cost basis.
    projectedProfit = round2(netProceeds - costBasis);
    projectedMargin = revenue > 0 ? projectedProfit / revenue : null;
  } else if (unitPrice !== null) {
    const gross = unitPrice * remainingQty;
    const fees = fee ? (gross * fee.feePercent) / 100 + fee.fixedFee * remainingQty : 0;
    projectedProfit = round2(netProceeds + gross - fees - costBasis);
    const totalRevenue = revenue + gross;
    projectedMargin = totalRevenue > 0 ? projectedProfit / totalRevenue : null;
  }

  return {
    purchase: round2(purchase),
    allocated: round2(allocated),
    expenses: round2(exp),
    parts: round2(parts),
    costBasis,
    unitCost: round2(unitCost),
    soldQty,
    remainingQty,
    revenue,
    sellingCosts,
    netProceeds,
    cogsSold,
    realizedProfit,
    margin: revenue > 0 ? realizedProfit / revenue : null,
    roi: cogsSold > 0 ? realizedProfit / cogsSold : null,
    projectedProfit,
    projectedMargin,
    daysToSell,
    daysHeld,
    pendingParts: round2(pendingPartsCost(requirements)),
    firstSaleDate,
    lastSaleDate,
  };
}

/**
 * Spread `shared` project cost over items. Amounts are rounded to cents and the
 * rounding remainder goes to the heaviest item so the parts always add up.
 */
export function allocateSharedCosts(
  shared: number,
  items: readonly Item[],
  method: AllocationMethod,
  salesByItem: ReadonlyMap<ID, readonly Sale[]> = new Map(),
): Map<ID, number> {
  const out = new Map<ID, number>();
  items = items.filter((it) => !EXCLUDED_FROM_ALLOCATION.includes(it.status));
  if (!items.length) return out;
  if (method === 'manual') {
    for (const it of items) out.set(it.id, round2(it.manualAllocation ?? 0));
    return out;
  }
  const weights = items.map((it) => {
    const qty = Math.max(1, it.quantity);
    if (method === 'equal') return qty;
    let unit = expectedUnitPrice(it);
    if (unit === null) {
      const sales = salesByItem.get(it.id) ?? [];
      const soldQty = sum(sales, (s) => s.quantity);
      if (soldQty > 0) unit = sum(sales, (s) => s.price) / soldQty;
    }
    return (unit ?? 0) * qty;
  });
  let total = sum(weights, (w) => w);
  const finalWeights = total > 0 ? weights : items.map((it) => Math.max(1, it.quantity));
  total = total > 0 ? total : sum(finalWeights, (w) => w);

  let allocatedSum = 0;
  let heaviest = 0;
  items.forEach((it, i) => {
    const amount = round2((shared * finalWeights[i]) / total);
    out.set(it.id, amount);
    allocatedSum += amount;
    if (finalWeights[i] > finalWeights[heaviest]) heaviest = i;
  });
  const diff = round2(shared - allocatedSum);
  if (diff !== 0) {
    const id = items[heaviest].id;
    out.set(id, round2((out.get(id) ?? 0) + diff));
  }
  return out;
}

export interface ProjectFinancials {
  acquisition: number;
  projectExpenses: number;
  projectParts: number;
  shared: number;
  itemOwnCosts: number;
  totalCost: number;
  revenue: number;
  sellingCosts: number;
  netProceeds: number;
  profit: number;
  margin: number | null;
  recovered: number | null;
  itemCount: number;
  activeCount: number;
  finishedCount: number;
  unitsTotal: number;
  unitsSold: number;
  unsoldValue: number;
  projectedProfit: number;
  pendingParts: number;
  budgetUsed: number | null;
  unallocated: number;
}

export interface Dataset {
  items: readonly Item[];
  projects: readonly Project[];
  sales: readonly Sale[];
  expenses: readonly Expense[];
  requirements: readonly Requirement[];
}

export interface Ledger {
  items: Map<ID, ItemFinancials>;
  projects: Map<ID, ProjectFinancials>;
  allocations: Map<ID, number>;
  salesByItem: Map<ID, Sale[]>;
}

function indexBy<T>(list: readonly T[], key: (x: T) => ID | null | undefined): Map<ID, T[]> {
  const m = new Map<ID, T[]>();
  for (const x of list) {
    const k = key(x);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Compute financials for every item and project in one pass. */
export function buildLedger(ds: Dataset, fee?: FeeLike): Ledger {
  const salesByItem = indexBy(ds.sales, (s) => s.itemId);
  const itemExpenses = indexBy(
    ds.expenses.filter((e) => e.ownerType === 'item'),
    (e) => e.ownerId,
  );
  const projectExpenses = indexBy(
    ds.expenses.filter((e) => e.ownerType === 'project'),
    (e) => e.ownerId,
  );
  const itemReqs = indexBy(
    ds.requirements.filter((r) => r.ownerType === 'item'),
    (r) => r.ownerId,
  );
  const projectReqs = indexBy(
    ds.requirements.filter((r) => r.ownerType === 'project'),
    (r) => r.ownerId,
  );
  const itemsByProject = indexBy(ds.items, (i) => i.projectId);

  const allocations = new Map<ID, number>();
  const sharedByProject = new Map<ID, { acquisition: number; exp: number; parts: number; shared: number }>();
  for (const p of ds.projects) {
    const acquisition = p.purchasePrice + p.purchaseCosts;
    const exp = sum(projectExpenses.get(p.id) ?? [], (e) => e.amount);
    const parts = partsCost(projectReqs.get(p.id) ?? []);
    const shared = round2(acquisition + exp + parts);
    sharedByProject.set(p.id, { acquisition, exp, parts, shared });
    const members = itemsByProject.get(p.id) ?? [];
    for (const [id, amt] of allocateSharedCosts(shared, members, p.allocation, salesByItem))
      allocations.set(id, amt);
  }

  const items = new Map<ID, ItemFinancials>();
  for (const it of ds.items) {
    items.set(
      it.id,
      itemFinancials(
        {
          item: it,
          sales: salesByItem.get(it.id),
          expenses: itemExpenses.get(it.id),
          requirements: itemReqs.get(it.id),
          allocated: allocations.get(it.id) ?? 0,
        },
        fee,
      ),
    );
  }

  const projects = new Map<ID, ProjectFinancials>();
  for (const p of ds.projects) {
    const members = itemsByProject.get(p.id) ?? [];
    const s = sharedByProject.get(p.id)!;
    const fins = members.map((m) => items.get(m.id)!);
    const itemOwnCosts = round2(sum(fins, (f) => f.purchase + f.expenses + f.parts));
    const totalCost = round2(s.shared + itemOwnCosts);
    const revenue = round2(sum(fins, (f) => f.revenue));
    const sellingCosts = round2(sum(fins, (f) => f.sellingCosts));
    const netProceeds = round2(revenue - sellingCosts);
    const profit = round2(netProceeds - totalCost);
    const active = members.filter((m) => ACTIVE_ITEM_STATUSES.includes(m.status));
    let unsoldValue = 0;
    let unsoldFees = 0;
    for (const m of active) {
      const unit = expectedUnitPrice(m) ?? 0;
      const remaining = items.get(m.id)!.remainingQty;
      unsoldValue += unit * remaining;
      if (fee && unit > 0) unsoldFees += (unit * remaining * fee.feePercent) / 100 + fee.fixedFee * remaining;
    }
    const allocatedTotal = sum(members, (m) => allocations.get(m.id) ?? 0);
    const pendingParts = pendingPartsCost(projectReqs.get(p.id) ?? []) + sum(fins, (f) => f.pendingParts);
    projects.set(p.id, {
      acquisition: round2(s.acquisition),
      projectExpenses: round2(s.exp),
      projectParts: round2(s.parts),
      shared: s.shared,
      itemOwnCosts,
      totalCost,
      revenue,
      sellingCosts,
      netProceeds,
      profit,
      margin: revenue > 0 ? profit / revenue : null,
      recovered: totalCost > 0 ? netProceeds / totalCost : null,
      itemCount: members.length,
      activeCount: active.length,
      finishedCount: members.length - active.length,
      unitsTotal: sum(members, (m) => Math.max(1, m.quantity)),
      unitsSold: sum(fins, (f) => f.soldQty),
      unsoldValue: round2(unsoldValue),
      projectedProfit: round2(profit + unsoldValue - unsoldFees),
      pendingParts: round2(pendingParts),
      budgetUsed: p.budget ? totalCost / p.budget : null,
      unallocated: round2(s.shared - allocatedTotal),
    });
  }

  return { items, projects, allocations, salesByItem };
}
