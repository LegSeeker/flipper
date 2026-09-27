import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addRequirement,
  addSale,
  createItem,
  createProject,
  deleteItems,
  deleteProject,
  deleteSale,
  emptyRequirement,
  updateItem,
  updateRequirement,
  updateSettings,
} from './repo';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('repo', () => {
  it('assigns sequential, unique human IDs', async () => {
    await updateSettings({ itemPrefix: 'FL', idPadding: 5 });
    const a = await createItem({ name: 'A' });
    const b = await createItem({ name: 'B' });
    expect(a.code).toBe('FL-00001');
    expect(b.code).toBe('FL-00002');
    const p = await createProject({ name: 'P' });
    expect(p.code).toBe('PR-00001');
  });

  it('skips codes that already exist (e.g. after an import)', async () => {
    await db.items.add({ ...(await createItem({ name: 'x' })), id: 'imported', code: 'FL-00002' });
    const next = await createItem({ name: 'y' });
    expect(next.code).toBe('FL-00003');
  });

  it('marks an item sold when all units sell, and reverts when a sale is removed', async () => {
    const item = await createItem({ name: 'Lot', quantity: 2, status: 'listed', listPrice: 5 });
    await addSale({
      itemId: item.id,
      quantity: 1,
      price: 5,
      shippingCharged: 0,
      shippingCost: 0,
      fees: 0,
      platform: 'ebay',
      date: '2026-03-01',
      buyer: '',
      notes: '',
    });
    expect((await db.items.get(item.id))!.status).toBe('listed');
    const s2 = await addSale({
      itemId: item.id,
      quantity: 1,
      price: 5,
      shippingCharged: 0,
      shippingCost: 0,
      fees: 0,
      platform: 'ebay',
      date: '2026-03-04',
      buyer: '',
      notes: '',
    });
    const sold = (await db.items.get(item.id))!;
    expect(sold.status).toBe('sold');
    expect(sold.finishedAt).toBe('2026-03-04');
    await deleteSale(s2.id);
    const back = (await db.items.get(item.id))!;
    expect(back.status).toBe('listed');
    expect(back.finishedAt).toBeNull();
  });

  it('sets listedAt when an item is listed', async () => {
    const item = await createItem({ name: 'x' });
    await updateItem(item.id, { status: 'listed' });
    expect((await db.items.get(item.id))!.listedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('marks stock used in a repair as consumed once installed', async () => {
    const part = await createItem({ name: 'SSD' });
    const target = await createItem({ name: 'Laptop' });
    const req = await addRequirement({
      ...emptyRequirement('item', target.id),
      name: 'SSD',
      inventoryItemId: part.id,
      status: 'in_stock',
    });
    await updateRequirement(req.id, { status: 'installed' });
    expect((await db.items.get(part.id))!.status).toBe('consumed');
    await updateRequirement(req.id, { status: 'in_stock' });
    expect((await db.items.get(part.id))!.status).toBe('in_stock');
  });

  it('cascades deletes and records tombstones for sync', async () => {
    const item = await createItem({ name: 'x' });
    const child = await createItem({ name: 'child', parentItemId: item.id });
    await addSale({
      itemId: item.id,
      quantity: 1,
      price: 1,
      shippingCharged: 0,
      shippingCost: 0,
      fees: 0,
      platform: 'ebay',
      date: '2026-01-01',
      buyer: '',
      notes: '',
    });
    await deleteItems([item.id]);
    expect(await db.items.get(item.id)).toBeUndefined();
    expect(await db.sales.count()).toBe(0);
    expect((await db.items.get(child.id))!.parentItemId).toBeNull();
    const tables = (await db.tombstones.toArray()).map((t) => t.table).sort();
    expect(tables).toEqual(['items', 'sales']);
  });

  it('can delete a project but keep its items', async () => {
    const p = await createProject({ name: 'P' });
    const it = await createItem({ name: 'x', projectId: p.id });
    await deleteProject(p.id, { deleteItems: false });
    expect(await db.projects.get(p.id)).toBeUndefined();
    expect((await db.items.get(it.id))!.projectId).toBeNull();
  });
});
