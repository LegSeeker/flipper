import { db } from '@/db/db';
import type { ImageMeta, ImageRecord, SyncedTable } from '@/db/schema';
import { diffSnapshots, emptySnapshot, SNAPSHOT_TABLES, type Snapshot } from './snapshot';

export function stripImage(img: ImageRecord): ImageMeta {
  const { blob: _b, thumb: _t, ...meta } = img;
  return meta;
}

/** Read the whole local database as a snapshot (without image bytes). */
export async function readLocalSnapshot(): Promise<Snapshot> {
  const snap = emptySnapshot();
  const [
    settings,
    counters,
    tombstones,
    items,
    projects,
    sales,
    expenses,
    requirements,
    comps,
    conversations,
  ] = await Promise.all([
    db.settings.get('app'),
    db.meta.toArray(),
    db.tombstones.toArray(),
    db.items.toArray(),
    db.projects.toArray(),
    db.sales.toArray(),
    db.expenses.toArray(),
    db.requirements.toArray(),
    db.comps.toArray(),
    db.conversations.toArray(),
  ]);
  const images: ImageMeta[] = [];
  await db.images.each((img) => {
    images.push(stripImage(img));
  });
  snap.settings = settings ?? null;
  snap.counters = counters;
  snap.tombstones = tombstones;
  snap.tables = { items, projects, sales, expenses, requirements, comps, conversations, images };
  return snap;
}

/**
 * Write the differences between `before` (current local state) and `after`
 * (merged state) to IndexedDB. Image records are only written when their bytes
 * are supplied via `imageBlobs`; the sync engine downloads them first.
 */
export async function applySnapshot(
  before: Snapshot,
  after: Snapshot,
  imageBlobs: Map<string, { blob: Blob; thumb: Blob }> = new Map(),
): Promise<{ written: number; deleted: number }> {
  const diff = diffSnapshots(before, after);
  let written = 0;
  let deleted = 0;
  const tables = [...SNAPSHOT_TABLES.map((t) => db.table(t)), db.settings, db.meta, db.tombstones];
  await db.transaction('rw', tables, async () => {
    for (const name of SNAPSHOT_TABLES) {
      const { put, del } = diff[name as SyncedTable];
      const table = db.table(name);
      if (name === 'images') {
        const localImages = new Set(before.tables.images.map((i) => i.id));
        for (const meta of put as ImageMeta[]) {
          const bytes = imageBlobs.get(meta.id);
          if (bytes) {
            await table.put({ ...meta, ...bytes });
            written++;
          } else if (localImages.has(meta.id)) {
            await table.update(meta.id, { ...meta });
            written++;
          }
        }
      } else if (put.length) {
        await table.bulkPut(put);
        written += put.length;
      }
      if (del.length) {
        await table.bulkDelete(del);
        deleted += del.length;
      }
    }
    if (after.settings) await db.settings.put(after.settings);
    if (after.counters.length) await db.meta.bulkPut(after.counters);
    if (after.tombstones.length) await db.tombstones.bulkPut(after.tombstones);
  });
  return { written, deleted };
}
