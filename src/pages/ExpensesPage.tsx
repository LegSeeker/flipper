import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { deleteExpense } from '@/db/repo';
import type { Expense } from '@/db/schema';
import { useFormat } from '@/app/context';
import { useDataset } from '@/app/data';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Stat } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/dialog';
import { ExpenseDialog } from '@/components/expenses/ExpenseDialog';
import { inRange, PERIOD_LABELS, periodRange, type PeriodKey } from '@/lib/dates';
import { titleCase } from '@/lib/utils';

type Scope = 'general' | 'all';

export default function ExpensesPage() {
  const ds = useDataset();
  const f = useFormat();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') as PeriodKey) || 'ytd';
  const scope = (params.get('scope') as Scope) || 'general';
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const range = periodRange(period);

  const list = useMemo(
    () =>
      (ds?.expenses ?? [])
        .filter(
          (e) => (scope === 'all' || e.ownerType === 'general') && inRange(e.date, range.from, range.to),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [ds, scope, range.from, range.to],
  );
  const total = list.reduce((s, e) => s + e.amount, 0);

  const ownerLabel = (e: Expense) => {
    if (e.ownerType === 'item') {
      const it = ds?.items.find((i) => i.id === e.ownerId);
      return it ? (
        <Link className="hover:text-accent" to={`/items/${it.id}`}>
          {it.code}
        </Link>
      ) : (
        'Item'
      );
    }
    if (e.ownerType === 'project') {
      const p = ds?.projects.find((x) => x.id === e.ownerId);
      return p ? (
        <Link className="hover:text-accent" to={`/projects/${p.id}`}>
          {p.code}
        </Link>
      ) : (
        'Project'
      );
    }
    return 'Business';
  };

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Business overheads: packaging, fuel, fees, subscriptions, tools"
        actions={
          <Button variant="primary" onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>
            <span className="hidden sm:inline">Add expense</span>
          </Button>
        }
      />
      <Page>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={scope}
            onChange={(v) => setParams({ period, scope: v }, { replace: true })}
            options={[
              { value: 'general', label: 'Business' },
              { value: 'all', label: 'Incl. item & project costs' },
            ]}
          />
          <Select
            value={period}
            onChange={(e) => setParams({ period: e.target.value, scope }, { replace: true })}
            className="w-auto"
            aria-label="Period"
          >
            {Object.entries(PERIOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total" value={f.money(total)} sub={`${list.length} entries`} />
        </div>
        {list.length ? (
          <Card className="divide-y divide-border">
            {list.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(e)}>
                  <div className="truncate">{e.label}</div>
                  <div className="text-xs text-subtle">
                    {f.date(e.date)} · {titleCase(e.category)}
                  </div>
                </button>
                <span className="text-xs text-subtle">{ownerLabel(e)}</span>
                <span className="tabular w-24 text-right">{f.money(e.amount)}</span>
                <button
                  type="button"
                  aria-label="Delete expense"
                  className="text-subtle hover:text-loss"
                  onClick={async () => {
                    if (await confirm({ title: 'Delete expense?', danger: true, confirmLabel: 'Delete' }))
                      await deleteExpense(e.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={<Wallet />}
              title="No expenses in this period"
              description="Recording overheads gives you a true net profit in reports."
            />
          </Card>
        )}
      </Page>
      <ExpenseDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        expense={editing === 'new' || editing === null ? undefined : editing}
        ownerType={
          editing && editing !== 'new' && editing.ownerType !== 'general' ? editing.ownerType : undefined
        }
        ownerId={editing && editing !== 'new' ? (editing.ownerId ?? undefined) : undefined}
      />
    </>
  );
}
