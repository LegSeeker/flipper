import { describe, expect, it } from 'vitest';
import { buildLedger } from './calc';
import { buildReport, inventorySnapshot } from './stats';
import { makeExpense, makeItem, makeSale } from '@/test/factories';

describe('buildReport', () => {
  const a = makeItem({ purchasePrice: 40, category: 'Audio', status: 'sold', purchaseDate: '2026-01-01' });
  const b = makeItem({ purchasePrice: 100, category: 'Gaming', status: 'sold', purchaseDate: '2026-01-01' });
  const c = makeItem({ purchasePrice: 30, status: 'written_off', finishedAt: '2026-02-10' });
  const d = makeItem({ purchasePrice: 10, status: 'listed', listPrice: 25, listedAt: '2025-01-01' });
  const sales = [
    makeSale(a.id, { price: 100, fees: 10, shippingCost: 5, date: '2026-01-20', platform: 'ebay' }),
    makeSale(b.id, { price: 80, date: '2026-02-05', platform: 'local' }),
  ];
  const expenses = [
    makeExpense({ amount: 12, date: '2026-02-01', category: 'supplies' }),
    makeExpense({ ownerType: 'item', ownerId: a.id, amount: 5, date: '2026-01-05' }),
  ];
  const ds = { items: [a, b, c, d], projects: [], sales, expenses, requirements: [] };
  const ledger = buildLedger(ds);

  it('builds a P&L on a cost-of-goods-sold basis', () => {
    const r = buildReport(ds, ledger, { from: '2026-01-01', to: '2026-03-31' });
    expect(r.revenue).toBe(180);
    expect(r.sellingCosts).toBe(15);
    expect(r.cogs).toBe(145); // 40 + 5 expense, 100
    expect(r.grossProfit).toBe(20);
    expect(r.generalExpenses).toBe(12);
    expect(r.writeOffs).toBe(30);
    expect(r.netProfit).toBe(-22);
    expect(r.salesCount).toBe(2);
    expect(r.avgDaysToSell).toBe(Math.round((19 + 35) / 2));
  });

  it('breaks results down by category, platform and month', () => {
    const r = buildReport(ds, ledger, { from: '2026-01-01', to: '2026-03-31' }, (id) => id.toUpperCase());
    expect(r.byCategory.map((x) => x.name).sort()).toEqual(['Audio', 'Gaming']);
    expect(r.byPlatform.find((x) => x.name === 'EBAY')!.profit).toBe(40);
    expect(r.monthly.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(r.monthly[0].grossProfit).toBe(40);
    expect(r.monthly[1].expenses).toBe(42); // overhead 12 + write-off 30
    expect(r.topItems[0].item.id).toBe(a.id);
    expect(r.worstItems[0].item.id).toBe(b.id);
  });

  it('respects the date range', () => {
    const r = buildReport(ds, ledger, { from: '2026-02-01', to: '2026-02-28' });
    expect(r.revenue).toBe(80);
    expect(r.salesCount).toBe(1);
  });

  it('summarises current stock and flags stale listings', () => {
    const snap = inventorySnapshot(ds, ledger, { staleDays: 30 }, new Set());
    expect(snap.units).toBe(1);
    expect(snap.costValue).toBe(10);
    expect(snap.estimatedValue).toBe(25);
    expect(snap.stale.map((i) => i.id)).toEqual([d.id]);
    expect(snap.missingPhotos).toHaveLength(1);
  });
});
