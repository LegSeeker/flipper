import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/db/defaults';
import { diffSnapshots, emptySnapshot, mergeSnapshots, parseSnapshot, type Snapshot } from './snapshot';
import { makeItem } from '@/test/factories';

function snap(patch: Partial<Snapshot['tables']> = {}, extra: Partial<Snapshot> = {}): Snapshot {
  const s = emptySnapshot();
  s.settings = { ...createDefaultSettings(), updatedAt: 1 };
  s.tables = { ...s.tables, ...patch };
  return { ...s, ...extra };
}

describe('mergeSnapshots', () => {
  it('keeps the most recently updated version of each record', () => {
    const base = makeItem({ code: 'FL-00001', name: 'old', updatedAt: 10 });
    const local = snap({ items: [{ ...base, name: 'local edit', updatedAt: 20 }] });
    const remote = snap({ items: [{ ...base, name: 'remote edit', updatedAt: 30 }] });
    expect(mergeSnapshots(local, remote).merged.tables.items[0].name).toBe('remote edit');
    expect(mergeSnapshots(remote, local).merged.tables.items[0].name).toBe('remote edit');
  });

  it('unions records that exist on only one side', () => {
    const a = makeItem({ code: 'FL-00001' });
    const b = makeItem({ code: 'FL-00002' });
    const { merged } = mergeSnapshots(snap({ items: [a] }), snap({ items: [b] }));
    expect(merged.tables.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('applies deletions from either side via tombstones', () => {
    const a = makeItem({ code: 'FL-00001', updatedAt: 10 });
    const local = snap({ items: [a] });
    const remote = snap({}, { tombstones: [{ id: a.id, table: 'items', deletedAt: 15 }] });
    const { merged } = mergeSnapshots(local, remote);
    expect(merged.tables.items).toHaveLength(0);
    expect(merged.tombstones).toHaveLength(1);
  });

  it('keeps a record edited after it was deleted elsewhere', () => {
    const a = makeItem({ code: 'FL-00001', updatedAt: 50 });
    const { merged } = mergeSnapshots(
      snap({ items: [a] }),
      snap({}, { tombstones: [{ id: a.id, table: 'items', deletedAt: 40 }] }),
    );
    expect(merged.tables.items).toHaveLength(1);
  });

  it('renumbers duplicate codes created offline on two devices', () => {
    const first = makeItem({ code: 'FL-00003', createdAt: 100 });
    const second = makeItem({ code: 'FL-00003', createdAt: 200 });
    const local = snap({ items: [first] }, { counters: [{ key: 'counter:item', value: 3 }] });
    const remote = snap({ items: [second] }, { counters: [{ key: 'counter:item', value: 3 }] });
    const { merged, recoded } = mergeSnapshots(local, remote, 999);
    const codes = merged.tables.items.map((i) => i.code).sort();
    expect(codes).toEqual(['FL-00003', 'FL-00004']);
    expect(recoded).toEqual([{ table: 'items', id: second.id, from: 'FL-00003', to: 'FL-00004' }]);
    expect(merged.tables.items.find((i) => i.id === second.id)!.updatedAt).toBe(999);
    expect(merged.counters.find((c) => c.key === 'counter:item')!.value).toBe(4);
  });

  it('takes the highest counter from either side', () => {
    const { merged } = mergeSnapshots(
      snap({}, { counters: [{ key: 'counter:item', value: 7 }] }),
      snap({}, { counters: [{ key: 'counter:item', value: 12 }] }),
    );
    expect(merged.counters[0].value).toBe(12);
  });
});

describe('diffSnapshots', () => {
  it('lists records to write and delete', () => {
    const a = makeItem({ code: 'FL-00001', updatedAt: 1 });
    const b = makeItem({ code: 'FL-00002', updatedAt: 1 });
    const before = snap({ items: [a, b] });
    const after = snap({ items: [{ ...a, name: 'changed', updatedAt: 2 }] });
    const d = diffSnapshots(before, after);
    expect(d.items.put.map((r) => r.id)).toEqual([a.id]);
    expect(d.items.del).toEqual([b.id]);
  });
});

describe('parseSnapshot', () => {
  it('rejects unrelated JSON', () => {
    expect(() => parseSnapshot({ hello: 'world' })).toThrow(/not a valid/);
  });
  it('accepts a round-tripped snapshot', () => {
    const s = snap({ items: [makeItem()] });
    expect(parseSnapshot(JSON.parse(JSON.stringify(s))).tables.items).toHaveLength(1);
  });
});
