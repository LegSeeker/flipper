import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '@/db/db';
import { deleteSale } from '@/db/repo';
import type { Sale } from '@/db/schema';
import { useFormat, useSettings } from '@/app/context';
import { saleNet } from '@/lib/calc';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { SaleDialog } from './SaleDialog';

export function SalesList({ itemId, canAdd }: { itemId: string; canAdd: boolean }) {
  const sales = useLiveQuery(() => db.sales.where('itemId').equals(itemId).sortBy('date'), [itemId]);
  const settings = useSettings();
  const f = useFormat();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Sale | 'new' | null>(null);
  const platformName = (id: string) => settings.platforms.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-2">
      {sales?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {sales.map((s) => {
            const n = saleNet(s);
            return (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(s)}>
                  <div className="truncate">
                    {s.quantity > 1 && `${s.quantity}× `}
                    {platformName(s.platform)} {s.buyer && <span className="text-subtle">· {s.buyer}</span>}
                  </div>
                  <div className="text-xs text-subtle">
                    {f.date(s.date)} · fees {f.money(s.fees)} · postage {f.money(s.shippingCost)}
                  </div>
                </button>
                <div className="tabular text-right">
                  <div>{f.money(n.revenue)}</div>
                  <div className="text-xs text-subtle">net {f.money(n.net)}</div>
                </div>
                <button
                  type="button"
                  aria-label="Delete sale"
                  className="text-subtle hover:text-loss"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Delete this sale?',
                        message: 'The item goes back to stock if nothing else sold.',
                        danger: true,
                        confirmLabel: 'Delete',
                      })
                    )
                      await deleteSale(s.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-subtle">Not sold yet.</p>
      )}
      {canAdd && (
        <Button
          size="sm"
          variant="primary"
          onClick={() => setEditing('new')}
          icon={<Plus className="size-4" />}
        >
          Record sale
        </Button>
      )}
      <SaleDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        itemId={itemId}
        sale={editing === 'new' || editing === null ? undefined : editing}
      />
    </div>
  );
}
