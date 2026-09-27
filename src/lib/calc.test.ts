import { describe, expect, it } from 'vitest';
import { allocateSharedCosts, buildLedger, itemFinancials } from './calc';
import { makeExpense, makeItem, makeProject, makeRequirement, makeSale } from '@/test/factories';

describe('itemFinancials', () => {
  it('computes realized profit, margin and ROI for a sold item', () => {
    const item = makeItem({
      purchasePrice: 50,
      purchaseCosts: 5,
      status: 'sold',
      purchaseDate: '2026-01-01',
    });
    const sale = makeSale(item.id, {
      price: 120,
      shippingCharged: 10,
      shippingCost: 8,
      fees: 15.6,
      date: '2026-01-11',
    });
    const f = itemFinancials({
      item,
      sales: [sale],
      expenses: [makeExpense({ ownerType: 'item', ownerId: item.id, amount: 4.4 })],
      requirements: [makeRequirement({ ownerType: 'item', ownerId: item.id, actualCost: 10 })],
    });
    expect(f.costBasis).toBe(69.4); // 50 + 5 + 4.4 + 10
    expect(f.revenue).toBe(130);
    expect(f.sellingCosts).toBe(23.6);
    expect(f.netProceeds).toBe(106.4);
    expect(f.realizedProfit).toBe(37);
    expect(f.margin).toBeCloseTo(37 / 130);
    expect(f.roi).toBeCloseTo(37 / 69.4);
    expect(f.daysToSell).toBe(10);
    expect(f.projectedProfit).toBe(37);
  });

  it('only charges the cost of units actually sold for partial sales', () => {
    const item = makeItem({ purchasePrice: 30, quantity: 10, status: 'listed', listPrice: 5 });
    const f = itemFinancials({ item, sales: [makeSale(item.id, { quantity: 4, price: 20 })] });
    expect(f.unitCost).toBe(3);
    expect(f.soldQty).toBe(4);
    expect(f.remainingQty).toBe(6);
    expect(f.cogsSold).toBe(12);
    expect(f.realizedProfit).toBe(8);
    // 20 received + 6 × 5 expected − 30 cost (no fee given)
    expect(f.projectedProfit).toBe(20);
  });

  it('deducts estimated platform fees from projections', () => {
    const item = makeItem({ purchasePrice: 40, listPrice: 100 });
    const f = itemFinancials({ item }, { feePercent: 10, fixedFee: 0.3 });
    expect(f.projectedProfit).toBe(49.7);
  });

  it('projects nothing without a price, and nothing for kept / consumed items', () => {
    expect(itemFinancials({ item: makeItem({ purchasePrice: 10 }) }).projectedProfit).toBeNull();
    expect(
      itemFinancials({ item: makeItem({ purchasePrice: 10, status: 'kept', listPrice: 50 }) })
        .projectedProfit,
    ).toBeNull();
    expect(
      itemFinancials({ item: makeItem({ purchasePrice: 10, status: 'consumed' }) }).projectedProfit,
    ).toBeNull();
  });

  it('treats a written-off item as a full loss', () => {
    const f = itemFinancials({ item: makeItem({ purchasePrice: 25, status: 'written_off' }) });
    expect(f.projectedProfit).toBe(-25);
  });

  it('ignores parts that are still only estimated', () => {
    const item = makeItem({ purchasePrice: 10 });
    const f = itemFinancials({
      item,
      requirements: [
        makeRequirement({ ownerType: 'item', ownerId: item.id, estimatedCost: 30, status: 'needed' }),
      ],
    });
    expect(f.costBasis).toBe(10);
    expect(f.pendingParts).toBe(30);
  });
});

describe('allocateSharedCosts', () => {
  it('splits by value and always sums exactly to the shared cost', () => {
    const a = makeItem({ estimatedValue: 100 });
    const b = makeItem({ estimatedValue: 200 });
    const c = makeItem({ estimatedValue: 0.01 });
    const m = allocateSharedCosts(100, [a, b, c], 'value');
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    expect(Math.round(total * 100) / 100).toBe(100);
    expect(m.get(b.id)! / m.get(a.id)!).toBeCloseTo(2, 1);
  });

  it('splits equally per unit', () => {
    const a = makeItem({ quantity: 3 });
    const b = makeItem({ quantity: 1 });
    const m = allocateSharedCosts(40, [a, b], 'equal');
    expect(m.get(a.id)).toBe(30);
    expect(m.get(b.id)).toBe(10);
  });

  it('falls back to equal split when nothing has a value', () => {
    const a = makeItem();
    const b = makeItem();
    const m = allocateSharedCosts(10, [a, b], 'value');
    expect(m.get(a.id)).toBe(5);
    expect(m.get(b.id)).toBe(5);
  });

  it('uses manual amounts as entered', () => {
    const a = makeItem({ manualAllocation: 12.5 });
    const b = makeItem({ manualAllocation: null });
    const m = allocateSharedCosts(100, [a, b], 'manual');
    expect(m.get(a.id)).toBe(12.5);
    expect(m.get(b.id)).toBe(0);
  });

  it('excludes the parted-out source item', () => {
    const src = makeItem({ status: 'parted_out', estimatedValue: 5000 });
    const part = makeItem({ estimatedValue: 50 });
    const m = allocateSharedCosts(900, [src, part], 'value');
    expect(m.has(src.id)).toBe(false);
    expect(m.get(part.id)).toBe(900);
  });
});

describe('buildLedger', () => {
  it('computes project totals, break-even and allocations for a part-out', () => {
    const p = makeProject({ type: 'part_out', purchasePrice: 900, purchaseCosts: 100 });
    const lights = makeItem({ projectId: p.id, estimatedValue: 300, status: 'sold' });
    const wheels = makeItem({ projectId: p.id, estimatedValue: 700, status: 'listed' });
    const sales = [makeSale(lights.id, { price: 320, fees: 20 })];
    const expenses = [makeExpense({ ownerType: 'project', ownerId: p.id, amount: 50 })];
    const ledger = buildLedger({ items: [lights, wheels], projects: [p], sales, expenses, requirements: [] });

    const pf = ledger.projects.get(p.id)!;
    expect(pf.shared).toBe(1050);
    expect(pf.totalCost).toBe(1050);
    expect(pf.netProceeds).toBe(300);
    expect(pf.profit).toBe(-750);
    expect(pf.recovered).toBeCloseTo(300 / 1050);
    expect(pf.unsoldValue).toBe(700);
    expect(pf.projectedProfit).toBe(-50);
    expect(pf.unallocated).toBe(0);

    // 30% of shared cost goes to the lights
    expect(ledger.allocations.get(lights.id)).toBe(315);
    expect(ledger.items.get(lights.id)!.realizedProfit).toBe(-15);
  });

  it('counts item-level costs in the project total without double counting allocation', () => {
    const p = makeProject({ purchasePrice: 100 });
    const it = makeItem({ projectId: p.id, purchasePrice: 20, estimatedValue: 10 });
    const ledger = buildLedger({ items: [it], projects: [p], sales: [], expenses: [], requirements: [] });
    expect(ledger.projects.get(p.id)!.totalCost).toBe(120);
    expect(ledger.items.get(it.id)!.costBasis).toBe(120);
  });
});
