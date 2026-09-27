/**
 * All writes go through this module so that timestamps, human IDs, status side
 * effects and deletion tombstones (needed for sync) stay consistent.
 */
import { db } from './db';
import { createDefaultLocalSettings, createDefaultSettings, emptyItem, emptyProject } from './defaults';
import {
  ACTIVE_ITEM_STATUSES,
  type Comp,
  type Conversation,
  type Expense,
  type ID,
  type ImageRecord,
  type Item,
  type ItemStatus,
  type LocalSettings,
  type OwnerType,
  type Project,
  type Requirement,
  type Sale,
  type Settings,
  type SyncedTable,
} from './schema';
import { uid } from '@/lib/utils';
import { today } from '@/lib/dates';
import { processImage } from '@/lib/images';
import { formatCode } from '@/lib/codes';

export { formatCode };

type New<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

function stamp<T extends object>(data: T): T & { id: ID; createdAt: number; updatedAt: number } {
  const now = Date.now();
  return { ...data, id: uid(), createdAt: now, updatedAt: now };
}

async function tombstone(table: SyncedTable, ids: ID[]): Promise<void> {
  if (!ids.length) return;
  const deletedAt = Date.now();
  await db.tombstones.bulkPut(ids.map((id) => ({ id, table, deletedAt })));
}

// ---------------------------------------------------------------- Settings

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('app');
  if (existing) return { ...createDefaultSettings(), ...existing };
  const fresh = createDefaultSettings();
  await db.settings.put(fresh);
  return fresh;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'app', updatedAt: Date.now() });
}

export async function getLocalSettings(): Promise<LocalSettings> {
  const existing = await db.local.get('local');
  return { ...createDefaultLocalSettings(), ...existing };
}

export async function updateLocalSettings(patch: Partial<LocalSettings>): Promise<void> {
  const current = await getLocalSettings();
  await db.local.put({ ...current, ...patch, id: 'local' });
}

// ---------------------------------------------------------------- Human-readable IDs

/** Allocate the next sequential code, skipping any that already exist (e.g. from imports). */
export async function nextCode(kind: 'item' | 'project'): Promise<string> {
  const settings = await getSettings();
  const prefix = kind === 'item' ? settings.itemPrefix : settings.projectPrefix;
  const table = kind === 'item' ? db.items : db.projects;
  return db.transaction('rw', db.meta, table, async () => {
    const key = `counter:${kind}`;
    let n = (await db.meta.get(key))?.value ?? 0;
    let code: string;
    do {
      n += 1;
      code = formatCode(prefix, n, settings.idPadding);
    } while ((await table.where('code').equals(code).count()) > 0);
    await db.meta.put({ key, value: n });
    return code;
  });
}

// ---------------------------------------------------------------- Status side effects

export function isFinishedStatus(s: ItemStatus): boolean {
  return !ACTIVE_ITEM_STATUSES.includes(s);
}

/** Keep finishedAt/listedAt in sync with status changes. */
export function applyItemStatus(
  prev: Pick<Item, 'status' | 'finishedAt' | 'listedAt'> | null,
  patch: Partial<Item>,
): Partial<Item> {
  const next = { ...patch };
  const status = patch.status;
  if (!status || (prev && prev.status === status)) return next;
  if (isFinishedStatus(status)) {
    if (!prev?.finishedAt && patch.finishedAt === undefined) next.finishedAt = today();
  } else {
    next.finishedAt = null;
  }
  if (status === 'listed' && !prev?.listedAt && !patch.listedAt) next.listedAt = today();
  return next;
}

// ---------------------------------------------------------------- Items

export async function createItem(data: Partial<New<Item>> = {}): Promise<Item> {
  const code = await nextCode('item');
  const base = { ...emptyItem(), ...data };
  const withStatus = { ...base, ...applyItemStatus(null, { status: base.status }) };
  const item = stamp({ ...withStatus, code }) as Item;
  await db.items.add(item);
  return item;
}

export async function updateItem(id: ID, patch: Partial<Item>): Promise<void> {
  const prev = await db.items.get(id);
  if (!prev) throw new Error('Item not found');
  const { id: _i, createdAt: _c, code: _code, ...rest } = patch;
  await db.items.update(id, { ...applyItemStatus(prev, rest), updatedAt: Date.now() });
}

export async function bulkUpdateItems(ids: ID[], patch: Partial<Item>): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    for (const id of ids) await updateItem(id, patch);
  });
}

export async function duplicateItem(id: ID): Promise<Item> {
  const src = await db.items.get(id);
  if (!src) throw new Error('Item not found');
  const { id: _i, code: _c, createdAt: _cr, updatedAt: _u, ...rest } = src;
  return createItem({
    ...rest,
    name: `${src.name} (copy)`,
    status: 'in_stock',
    archived: false,
    finishedAt: null,
    listedAt: null,
    primaryImageId: null,
  });
}

async function deleteOwned(ownerType: OwnerType, ownerId: ID): Promise<void> {
  const [images, expenses, reqs] = await Promise.all([
    db.images.where('[ownerType+ownerId]').equals([ownerType, ownerId]).primaryKeys(),
    db.expenses.where('[ownerType+ownerId]').equals([ownerType, ownerId]).primaryKeys(),
    db.requirements.where('[ownerType+ownerId]').equals([ownerType, ownerId]).primaryKeys(),
  ]);
  await db.images.bulkDelete(images);
  await db.expenses.bulkDelete(expenses);
  await db.requirements.bulkDelete(reqs);
  await tombstone('images', images);
  await tombstone('expenses', expenses);
  await tombstone('requirements', reqs);
}

export async function deleteItems(ids: ID[]): Promise<void> {
  await db.transaction(
    'rw',
    [db.items, db.images, db.expenses, db.requirements, db.sales, db.comps, db.tombstones],
    async () => {
      for (const id of ids) {
        await deleteOwned('item', id);
        const sales = await db.sales.where('itemId').equals(id).primaryKeys();
        const comps = await db.comps.where('itemId').equals(id).primaryKeys();
        await db.sales.bulkDelete(sales);
        await db.comps.bulkDelete(comps);
        await tombstone('sales', sales);
        await tombstone('comps', comps);
        // Detach references instead of cascading.
        const now = Date.now();
        await db.items.where('parentItemId').equals(id).modify({ parentItemId: null, updatedAt: now });
        await db.requirements
          .where('inventoryItemId')
          .equals(id)
          .modify({ inventoryItemId: null, updatedAt: now });
        await db.items.delete(id);
        await tombstone('items', [id]);
      }
    },
  );
}

// ---------------------------------------------------------------- Projects

export async function createProject(data: Partial<New<Project>> = {}): Promise<Project> {
  const code = await nextCode('project');
  const project = stamp({ ...emptyProject(), ...data, code }) as Project;
  await db.projects.add(project);
  return project;
}

export async function updateProject(id: ID, patch: Partial<Project>): Promise<void> {
  const prev = await db.projects.get(id);
  if (!prev) throw new Error('Project not found');
  const { id: _i, createdAt: _c, code: _code, ...rest } = patch;
  const next: Partial<Project> = { ...rest, updatedAt: Date.now() };
  if (rest.status && rest.status !== prev.status) {
    next.finishedAt = rest.status === 'finished' ? (prev.finishedAt ?? today()) : null;
  }
  await db.projects.update(id, next);
}

export async function deleteProject(id: ID, opts: { deleteItems: boolean }): Promise<void> {
  const itemIds = await db.items.where('projectId').equals(id).primaryKeys();
  if (opts.deleteItems) await deleteItems(itemIds);
  else {
    const now = Date.now();
    await db.items.where('projectId').equals(id).modify({ projectId: null, updatedAt: now });
  }
  await db.transaction(
    'rw',
    [db.projects, db.images, db.expenses, db.requirements, db.tombstones],
    async () => {
      await deleteOwned('project', id);
      await db.projects.delete(id);
      await tombstone('projects', [id]);
    },
  );
}

// ---------------------------------------------------------------- Sales

async function refreshSoldStatus(itemId: ID): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) return;
  const sales = await db.sales.where('itemId').equals(itemId).toArray();
  const soldQty = sales.reduce((n, s) => n + s.quantity, 0);
  if (soldQty >= item.quantity && item.status !== 'sold') {
    const lastDate =
      sales
        .map((s) => s.date)
        .sort()
        .at(-1) ?? today();
    await updateItem(itemId, { status: 'sold', finishedAt: lastDate });
  } else if (soldQty < item.quantity && item.status === 'sold') {
    await updateItem(itemId, { status: item.listPrice ? 'listed' : 'in_stock' });
  }
}

export async function addSale(data: New<Sale>): Promise<Sale> {
  const sale = stamp(data) as Sale;
  await db.sales.add(sale);
  await refreshSoldStatus(sale.itemId);
  return sale;
}

export async function updateSale(id: ID, patch: Partial<Sale>): Promise<void> {
  const prev = await db.sales.get(id);
  if (!prev) return;
  await db.sales.update(id, { ...patch, updatedAt: Date.now() });
  await refreshSoldStatus(prev.itemId);
}

export async function deleteSale(id: ID): Promise<void> {
  const sale = await db.sales.get(id);
  if (!sale) return;
  await db.sales.delete(id);
  await tombstone('sales', [id]);
  await refreshSoldStatus(sale.itemId);
}

// ---------------------------------------------------------------- Expenses

export async function addExpense(data: New<Expense>): Promise<Expense> {
  const e = stamp(data) as Expense;
  await db.expenses.add(e);
  return e;
}

export async function updateExpense(id: ID, patch: Partial<Expense>): Promise<void> {
  await db.expenses.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteExpense(id: ID): Promise<void> {
  await db.expenses.delete(id);
  await tombstone('expenses', [id]);
}

// ---------------------------------------------------------------- Requirements (repair parts)

export function emptyRequirement(ownerType: OwnerType, ownerId: ID): New<Requirement> {
  return {
    ownerType,
    ownerId,
    name: '',
    quantity: 1,
    status: 'needed',
    estimatedCost: null,
    actualCost: null,
    inventoryItemId: null,
    supplier: '',
    url: '',
    priority: 'normal',
    notes: '',
  };
}

export async function addRequirement(data: New<Requirement>): Promise<Requirement> {
  const r = stamp(data) as Requirement;
  await db.requirements.add(r);
  await syncConsumedItem(r);
  return r;
}

export async function addRequirements(list: New<Requirement>[]): Promise<void> {
  const now = Date.now();
  await db.requirements.bulkAdd(list.map((r) => ({ ...r, id: uid(), createdAt: now, updatedAt: now })));
}

export async function updateRequirement(id: ID, patch: Partial<Requirement>): Promise<void> {
  await db.requirements.update(id, { ...patch, updatedAt: Date.now() });
  const r = await db.requirements.get(id);
  if (r) await syncConsumedItem(r);
}

export async function deleteRequirement(id: ID): Promise<void> {
  await db.requirements.delete(id);
  await tombstone('requirements', [id]);
}

/** A stock item used as a part becomes "consumed" once installed. */
async function syncConsumedItem(r: Requirement): Promise<void> {
  if (!r.inventoryItemId) return;
  const item = await db.items.get(r.inventoryItemId);
  if (!item) return;
  if (r.status === 'installed' && item.status !== 'consumed') {
    await updateItem(item.id, { status: 'consumed' });
  } else if (r.status !== 'installed' && item.status === 'consumed') {
    await updateItem(item.id, { status: 'in_stock' });
  }
}

// ---------------------------------------------------------------- Comps

export async function addComps(list: New<Comp>[]): Promise<void> {
  const now = Date.now();
  await db.comps.bulkAdd(list.map((c) => ({ ...c, id: uid(), createdAt: now, updatedAt: now })));
}

export async function deleteComp(id: ID): Promise<void> {
  await db.comps.delete(id);
  await tombstone('comps', [id]);
}

export async function clearComps(itemId: ID, source?: string): Promise<void> {
  const comps = await db.comps.where('itemId').equals(itemId).toArray();
  const ids = comps.filter((c) => !source || c.source === source).map((c) => c.id);
  await db.comps.bulkDelete(ids);
  await tombstone('comps', ids);
}

// ---------------------------------------------------------------- Images

export async function addImages(
  ownerType: OwnerType,
  ownerId: ID,
  files: File[],
): Promise<{ added: number; errors: string[] }> {
  const existing = await db.images.where('[ownerType+ownerId]').equals([ownerType, ownerId]).count();
  const errors: string[] = [];
  let order = existing;
  const added: ImageRecord[] = [];
  for (const file of files) {
    try {
      const p = await processImage(file);
      const now = Date.now();
      added.push({
        id: uid(),
        ownerType,
        ownerId,
        blob: p.blob,
        thumb: p.thumb,
        mime: p.mime,
        width: p.width,
        height: p.height,
        size: p.blob.size,
        order: order++,
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (added.length) {
    await db.images.bulkAdd(added);
    const table = ownerType === 'item' ? db.items : db.projects;
    const owner = await table.get(ownerId);
    if (owner && !owner.primaryImageId)
      await table.update(ownerId, { primaryImageId: added[0].id, updatedAt: Date.now() });
  }
  return { added: added.length, errors };
}

export async function deleteImage(id: ID): Promise<void> {
  const img = await db.images.get(id);
  if (!img) return;
  await db.images.delete(id);
  await tombstone('images', [id]);
  const table = img.ownerType === 'item' ? db.items : db.projects;
  const owner = await table.get(img.ownerId);
  if (owner?.primaryImageId === id) {
    const next = await db.images
      .where('[ownerType+ownerId]')
      .equals([img.ownerType, img.ownerId])
      .sortBy('order');
    await table.update(img.ownerId, { primaryImageId: next[0]?.id ?? null, updatedAt: Date.now() });
  }
}

export async function setPrimaryImage(ownerType: OwnerType, ownerId: ID, imageId: ID): Promise<void> {
  const table = ownerType === 'item' ? db.items : db.projects;
  await table.update(ownerId, { primaryImageId: imageId, updatedAt: Date.now() });
}

export async function reorderImages(ids: ID[]): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.images, async () => {
    for (const [order, id] of ids.entries()) await db.images.update(id, { order, updatedAt: now });
  });
}

// ---------------------------------------------------------------- Conversations

export async function saveConversation(
  c: Partial<Conversation> & Pick<Conversation, 'messages'>,
): Promise<Conversation> {
  const now = Date.now();
  if (c.id) {
    const existing = await db.conversations.get(c.id);
    if (existing) {
      const next = { ...existing, ...c, updatedAt: now } as Conversation;
      await db.conversations.put(next);
      return next;
    }
  }
  const conv: Conversation = {
    id: c.id ?? uid(),
    title: c.title ?? 'New chat',
    messages: c.messages,
    createdAt: now,
    updatedAt: now,
  };
  await db.conversations.put(conv);
  return conv;
}

export async function deleteConversation(id: ID): Promise<void> {
  await db.conversations.delete(id);
  await tombstone('conversations', [id]);
}

// ---------------------------------------------------------------- Danger zone

export async function eraseAllData(): Promise<void> {
  await db.delete();
  await db.open();
}
