/**
 * A snapshot is the portable form of the whole database (minus image bytes and
 * device secrets). It is used for backups and for Google Drive sync.
 *
 * Merging is per record, last-write-wins on `updatedAt`, with tombstones so a
 * delete on one device removes the record on the others.
 */
import { z } from 'zod';
import type {
  Comp,
  Conversation,
  Expense,
  ImageMeta,
  Item,
  MetaEntry,
  Project,
  Requirement,
  Sale,
  Settings,
  SyncedTable,
  Tombstone,
} from '@/db/schema';
import { formatCode } from '@/lib/codes';

export interface SnapshotTables {
  items: Item[];
  projects: Project[];
  sales: Sale[];
  expenses: Expense[];
  requirements: Requirement[];
  comps: Comp[];
  conversations: Conversation[];
  images: ImageMeta[];
}

export const SNAPSHOT_TABLES: SyncedTable[] = [
  'items',
  'projects',
  'sales',
  'expenses',
  'requirements',
  'comps',
  'conversations',
  'images',
];

export interface Snapshot {
  format: 'flipper-snapshot';
  version: 1;
  exportedAt: number;
  settings: Settings | null;
  counters: MetaEntry[];
  tables: SnapshotTables;
  tombstones: Tombstone[];
}

const recordList = z.array(z.looseObject({ id: z.string(), updatedAt: z.number() })).default([]);

export const snapshotSchema = z.object({
  format: z.literal('flipper-snapshot'),
  version: z.number().int().min(1),
  exportedAt: z.number(),
  settings: z.looseObject({ id: z.literal('app') }).nullable(),
  counters: z.array(z.object({ key: z.string(), value: z.number() })),
  tables: z.object({
    items: recordList,
    projects: recordList,
    sales: recordList,
    expenses: recordList,
    requirements: recordList,
    comps: recordList,
    conversations: recordList,
    images: recordList,
  }),
  tombstones: z.array(z.object({ id: z.string(), table: z.string(), deletedAt: z.number() })).default([]),
});

export function emptySnapshot(): Snapshot {
  return {
    format: 'flipper-snapshot',
    version: 1,
    exportedAt: Date.now(),
    settings: null,
    counters: [],
    tables: {
      items: [],
      projects: [],
      sales: [],
      expenses: [],
      requirements: [],
      comps: [],
      conversations: [],
      images: [],
    },
    tombstones: [],
  };
}

export function parseSnapshot(data: unknown): Snapshot {
  const parsed = snapshotSchema.safeParse(data);
  if (!parsed.success) throw new Error('This file is not a valid Flipper backup.');
  return parsed.data as unknown as Snapshot;
}

type Rec = { id: string; updatedAt: number };

export interface MergeResult {
  merged: Snapshot;
  /** Codes that had to change because two devices created the same one offline. */
  recoded: { table: 'items' | 'projects'; id: string; from: string; to: string }[];
}

function mergeTable<T extends Rec>(local: T[], remote: T[], tomb: Map<string, number>): T[] {
  const byId = new Map<string, T>();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) {
    const cur = byId.get(r.id);
    if (!cur || r.updatedAt > cur.updatedAt) byId.set(r.id, r);
  }
  const out: T[] = [];
  for (const r of byId.values()) {
    const deletedAt = tomb.get(r.id);
    if (deletedAt !== undefined && deletedAt >= r.updatedAt) continue;
    out.push(r);
  }
  return out;
}

function fixDuplicateCodes<T extends Rec & { code: string; createdAt: number }>(
  list: T[],
  prefix: string,
  padding: number,
  counter: MetaEntry,
  table: 'items' | 'projects',
  recoded: MergeResult['recoded'],
  now: number,
): T[] {
  const byCode = new Map<string, T[]>();
  for (const r of list) {
    const arr = byCode.get(r.code) ?? [];
    arr.push(r);
    byCode.set(r.code, arr);
  }
  const used = new Set(byCode.keys());
  const replaced = new Map<string, T>();
  for (const group of byCode.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const r of group.slice(1)) {
      let code: string;
      do {
        counter.value += 1;
        code = formatCode(prefix, counter.value, padding);
      } while (used.has(code));
      used.add(code);
      recoded.push({ table, id: r.id, from: r.code, to: code });
      replaced.set(r.id, { ...r, code, updatedAt: now });
    }
  }
  return replaced.size ? list.map((r) => replaced.get(r.id) ?? r) : list;
}

export function mergeSnapshots(local: Snapshot, remote: Snapshot, now = Date.now()): MergeResult {
  const tombById = new Map<string, Tombstone>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    const cur = tombById.get(t.id);
    if (!cur || t.deletedAt > cur.deletedAt) tombById.set(t.id, t);
  }
  const tomb = new Map([...tombById.values()].map((t) => [t.id, t.deletedAt]));

  const tables = {} as SnapshotTables;
  for (const name of SNAPSHOT_TABLES) {
    (tables as unknown as Record<string, Rec[]>)[name] = mergeTable(
      local.tables[name] as Rec[],
      (remote.tables[name] ?? []) as Rec[],
      tomb,
    );
  }

  const settings =
    !local.settings || (remote.settings && remote.settings.updatedAt > local.settings.updatedAt)
      ? remote.settings
      : local.settings;

  const counters = new Map<string, MetaEntry>();
  for (const c of [...local.counters, ...remote.counters]) {
    const cur = counters.get(c.key);
    if (!cur || c.value > cur.value) counters.set(c.key, { ...c });
  }
  const counterFor = (key: string) => {
    let c = counters.get(key);
    if (!c) counters.set(key, (c = { key, value: 0 }));
    return c;
  };

  const recoded: MergeResult['recoded'] = [];
  if (settings) {
    tables.items = fixDuplicateCodes(
      tables.items,
      settings.itemPrefix,
      settings.idPadding,
      counterFor('counter:item'),
      'items',
      recoded,
      now,
    );
    tables.projects = fixDuplicateCodes(
      tables.projects,
      settings.projectPrefix,
      settings.idPadding,
      counterFor('counter:project'),
      'projects',
      recoded,
      now,
    );
  }

  return {
    merged: {
      format: 'flipper-snapshot',
      version: 1,
      exportedAt: now,
      settings,
      counters: [...counters.values()],
      tables,
      tombstones: [...tombById.values()],
    },
    recoded,
  };
}

/** Records that differ between two snapshots: what must be written / deleted locally. */
export function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
): Record<SyncedTable, { put: Rec[]; del: string[] }> {
  const out = {} as Record<SyncedTable, { put: Rec[]; del: string[] }>;
  for (const name of SNAPSHOT_TABLES) {
    const prev = new Map((before.tables[name] as Rec[]).map((r) => [r.id, r]));
    const next = after.tables[name] as Rec[];
    const nextIds = new Set(next.map((r) => r.id));
    out[name] = {
      put: next.filter((r) => {
        const p = prev.get(r.id);
        return !p || p.updatedAt !== r.updatedAt || JSON.stringify(p) !== JSON.stringify(r);
      }),
      del: [...prev.keys()].filter((id) => !nextIds.has(id)),
    };
  }
  return out;
}
