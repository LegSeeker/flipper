import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { buildLedger, type Dataset, type Ledger } from '@/lib/calc';
import { useSettings } from './context';

/** Live view of every record needed for money calculations. */
export function useDataset(): Dataset | undefined {
  return useLiveQuery(async () => {
    const [items, projects, sales, expenses, requirements] = await Promise.all([
      db.items.toArray(),
      db.projects.toArray(),
      db.sales.toArray(),
      db.expenses.toArray(),
      db.requirements.toArray(),
    ]);
    return { items, projects, sales, expenses, requirements } satisfies Dataset;
  }, []);
}

export function useDefaultFee() {
  const settings = useSettings();
  return settings.platforms.find((p) => p.id === settings.defaultPlatformId) ?? settings.platforms[0];
}

export function useLedger(): { ds: Dataset; ledger: Ledger } | undefined {
  const ds = useDataset();
  const fee = useDefaultFee();
  return useMemo(() => (ds ? { ds, ledger: buildLedger(ds, fee) } : undefined), [ds, fee]);
}

/** Set of owner IDs that have at least one photo. */
export function useImageOwners(): Set<string> | undefined {
  return useLiveQuery(async () => new Set((await db.images.orderBy('ownerId').uniqueKeys()) as string[]), []);
}
