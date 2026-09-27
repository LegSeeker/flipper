import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '@/db/db';
import { deleteExpense } from '@/db/repo';
import type { Expense, ID, OwnerType } from '@/db/schema';
import { useFormat } from '@/app/context';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { ExpenseDialog } from './ExpenseDialog';
import { titleCase } from '@/lib/utils';

export function ExpenseList({ ownerType, ownerId }: { ownerType: OwnerType; ownerId: ID }) {
  const expenses = useLiveQuery(
    () => db.expenses.where('[ownerType+ownerId]').equals([ownerType, ownerId]).sortBy('date'),
    [ownerType, ownerId],
  );
  const f = useFormat();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  return (
    <div className="space-y-2">
      {expenses?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {expenses.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(e)}>
                <div className="truncate">{e.label}</div>
                <div className="text-xs text-subtle">
                  {titleCase(e.category)} · {f.date(e.date)}
                </div>
              </button>
              <span className="tabular">{f.money(e.amount)}</span>
              <button
                type="button"
                aria-label="Delete cost"
                className="text-subtle hover:text-loss"
                onClick={async () => {
                  if (await confirm({ title: 'Delete this cost?', danger: true, confirmLabel: 'Delete' }))
                    await deleteExpense(e.id);
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-subtle">No extra costs recorded.</p>
      )}
      <Button size="sm" onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>
        Add cost
      </Button>
      <ExpenseDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        ownerType={ownerType}
        ownerId={ownerId}
        expense={editing === 'new' || editing === null ? undefined : editing}
      />
    </div>
  );
}
