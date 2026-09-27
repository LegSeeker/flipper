import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  Boxes,
  CheckSquare,
  Download,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Printer,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { bulkUpdateItems, deleteItems } from '@/db/repo';
import { ACTIVE_ITEM_STATUSES, ITEM_STATUSES, type Item, type ItemStatus } from '@/db/schema';
import { useFormat, useSettings } from '@/app/context';
import { useLedger } from '@/app/data';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { Menu, Segmented } from '@/components/ui/segmented';
import { inputClass, Select } from '@/components/ui/field';
import { ITEM_STATUS_META, ItemStatusBadge, MoneyTone } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/dialog';
import { Thumb } from '@/components/images/images';
import { matches } from '@/components/layout/SearchDialog';
import type { ItemFinancials } from '@/lib/calc';
import { expectedUnitPrice } from '@/lib/calc';
import { csvBlob } from '@/lib/csv';
import { cn, downloadBlob } from '@/lib/utils';
import { today } from '@/lib/dates';

type Tab = 'active' | 'finished' | 'archived' | 'all';
type Sort = 'updated' | 'newest' | 'oldest' | 'name' | 'cost' | 'value' | 'profit' | 'held';

const SORTS: Record<Sort, string> = {
  updated: 'Recently updated',
  newest: 'Newest',
  oldest: 'Oldest',
  name: 'Name A–Z',
  cost: 'Cost (high → low)',
  value: 'Value (high → low)',
  profit: 'Profit (high → low)',
  held: 'Days held (longest)',
};

export function lifecycleOf(i: Item): Exclude<Tab, 'all'> {
  if (i.archived) return 'archived';
  return ACTIVE_ITEM_STATUSES.includes(i.status) ? 'active' : 'finished';
}

export default function ItemsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'active';
  const q = params.get('q') ?? '';
  const status = (params.get('status') as ItemStatus | '') || '';
  const category = params.get('category') ?? '';
  const project = params.get('project') ?? '';
  const sort = (params.get('sort') as Sort) || 'updated';
  const view = params.get('view') === 'grid' ? 'grid' : 'list';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const data = useLedger();
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const settings = useSettings();
  const f = useFormat();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [selecting, setSelecting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [status, category, project].filter(Boolean).length;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const c = { active: 0, finished: 0, archived: 0, all: 0 };
    for (const i of data?.ds.items ?? []) {
      c[lifecycleOf(i)]++;
      c.all++;
    }
    return c;
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const { ds, ledger } = data;
    const fin = (i: Item) => ledger.items.get(i.id)!;
    const filtered = ds.items.filter(
      (i) =>
        (tab === 'all' || lifecycleOf(i) === tab) &&
        (!status || i.status === status) &&
        (!category || i.category === category) &&
        (!project || (project === 'none' ? !i.projectId : i.projectId === project)) &&
        (!q ||
          matches(
            q,
            i.code,
            i.name,
            i.brand,
            i.model,
            i.category,
            i.storageLocation,
            i.barcode,
            i.tags.join(' '),
            i.notes,
          )),
    );
    const value = (i: Item) => (expectedUnitPrice(i) ?? 0) * Math.max(1, i.quantity);
    const profit = (i: Item) => fin(i).projectedProfit ?? fin(i).realizedProfit;
    const cmp: Record<Sort, (a: Item, b: Item) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      name: (a, b) => a.name.localeCompare(b.name),
      cost: (a, b) => fin(b).costBasis - fin(a).costBasis,
      value: (a, b) => value(b) - value(a),
      profit: (a, b) => profit(b) - profit(a),
      held: (a, b) => fin(b).daysHeld - fin(a).daysHeld,
    };
    return filtered.sort(cmp[sort]);
  }, [data, tab, status, category, project, q, sort]);

  const categories = useMemo(
    () => [...new Set((data?.ds.items ?? []).map((i) => i.category).filter(Boolean))].sort(),
    [data],
  );
  const statusOptions = ITEM_STATUSES.filter(
    (s) => tab === 'all' || tab === 'archived' || (tab === 'active') === ACTIVE_ITEM_STATUSES.includes(s),
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ids = [...selected];
  const endSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const exportCsv = () => {
    if (!data) return;
    const rows = list.map((i) => {
      const fi = data.ledger.items.get(i.id)!;
      return [
        i.code,
        i.name,
        i.brand,
        i.model,
        i.category,
        ITEM_STATUS_META[i.status].label,
        i.archived,
        i.condition,
        i.quantity,
        i.purchaseDate,
        i.purchaseSource,
        fi.purchase,
        fi.allocated,
        fi.expenses,
        fi.parts,
        fi.costBasis,
        i.listPrice,
        i.estimatedValue,
        fi.soldQty,
        fi.revenue,
        fi.sellingCosts,
        fi.realizedProfit,
        fi.projectedProfit,
        i.storageLocation,
        projects?.find((p) => p.id === i.projectId)?.code ?? '',
        i.tags.join('; '),
      ];
    });
    downloadBlob(
      csvBlob(
        [
          'ID',
          'Name',
          'Brand',
          'Model',
          'Category',
          'Status',
          'Archived',
          'Condition',
          'Qty',
          'Purchase date',
          'Source',
          'Purchase + costs',
          'Allocated project cost',
          'Expenses',
          'Parts',
          'Cost basis',
          'List price (unit)',
          'Est. value (unit)',
          'Sold qty',
          'Revenue',
          'Selling costs',
          'Realized profit',
          'Projected profit',
          'Location',
          'Project',
          'Tags',
        ],
        rows,
      ),
      `flipper-items-${today()}.csv`,
    );
  };

  return (
    <>
      <PageHeader
        title="Items"
        subtitle={`${list.length} shown`}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Select"
              onClick={() => (selecting ? endSelect() : setSelecting(true))}
            >
              {selecting ? <X className="size-5" /> : <CheckSquare className="size-5" />}
            </Button>
            <Menu
              trigger={(t) => (
                <Button variant="ghost" size="icon" aria-label="More" onClick={t}>
                  <MoreHorizontal className="size-5" />
                </Button>
              )}
              items={[
                { label: 'Export shown as CSV', icon: <Download />, onClick: exportCsv },
                {
                  label: 'Print labels for shown',
                  icon: <Printer />,
                  onClick: () => navigate(`/labels?ids=${list.map((i) => i.id).join(',')}`),
                },
              ]}
            />
            <ButtonLink
              to="/items/new"
              variant="primary"
              icon={<Plus className="size-4" />}
              className="hidden sm:inline-flex"
            >
              New item
            </ButtonLink>
          </>
        }
      />
      <Page>
        <div className="flex flex-col gap-3">
          <Segmented
            value={tab}
            onChange={(v) => {
              const next = new URLSearchParams(params);
              next.set('tab', v);
              next.delete('status');
              setParams(next, { replace: true });
            }}
            options={[
              { value: 'active', label: 'Active', count: counts.active },
              { value: 'finished', label: 'Finished', count: counts.finished },
              { value: 'archived', label: 'Archived', count: counts.archived },
              { value: 'all', label: 'All', count: counts.all },
            ]}
          />
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input
                value={q}
                onChange={(e) => setParam('q', e.target.value)}
                placeholder="Search name, ID, brand, tag, location…"
                className={cn(inputClass, 'h-10 pl-9')}
                type="search"
                aria-label="Search items"
              />
            </div>
            <Button
              className="relative sm:hidden"
              size="icon"
              aria-label="Filters"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <SlidersHorizontal className="size-4" />
              {activeFilters > 0 && (
                <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-accent text-[10px] text-accent-fg">
                  {activeFilters}
                </span>
              )}
            </Button>
            <Segmented
              size="sm"
              className="h-10 shrink-0 items-center"
              value={view}
              onChange={(v) => setParam('view', v === 'grid' ? 'grid' : '')}
              options={[
                { value: 'list', label: <List className="size-4" aria-label="List view" /> },
                { value: 'grid', label: <LayoutGrid className="size-4" aria-label="Grid view" /> },
              ]}
            />
          </div>
          <div className={cn('grid-cols-2 gap-2 sm:flex sm:flex-wrap', filtersOpen ? 'grid' : 'hidden')}>
            <Select
              value={status}
              onChange={(e) => setParam('status', e.target.value)}
              className="sm:w-auto sm:min-w-36"
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {ITEM_STATUS_META[s].label}
                </option>
              ))}
            </Select>
            <Select
              value={category}
              onChange={(e) => setParam('category', e.target.value)}
              className="sm:w-auto sm:min-w-36"
              aria-label="Category"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Select
              value={project}
              onChange={(e) => setParam('project', e.target.value)}
              className="sm:w-auto sm:min-w-36"
              aria-label="Project"
            >
              <option value="">Any project</option>
              <option value="none">No project</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.name}
                </option>
              ))}
            </Select>
            <Select
              value={sort}
              onChange={(e) => setParam('sort', e.target.value)}
              className="sm:w-auto sm:min-w-36"
              aria-label="Sort"
            >
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            {activeFilters > 0 && (
              <Button
                variant="ghost"
                className="col-span-2"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  ['status', 'category', 'project', 'q'].forEach((k) => next.delete(k));
                  setParams(next, { replace: true });
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {selecting && (
          <Card className="sticky top-16 z-10 flex flex-wrap items-center gap-2 p-2 lg:top-2">
            <span className="px-2 text-sm">{selected.size} selected</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(list.map((i) => i.id)))}>
              Select all
            </Button>
            <div className="flex-1" />
            <Select
              className="h-8 w-auto text-xs"
              value=""
              disabled={!ids.length}
              onChange={async (e) => {
                await bulkUpdateItems(ids, { status: e.target.value as ItemStatus });
                toast.success(`Updated ${ids.length} items`);
                endSelect();
              }}
            >
              <option value="">Set status…</option>
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ITEM_STATUS_META[s].label}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={!ids.length}
              icon={
                tab === 'archived' ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />
              }
              onClick={async () => {
                await bulkUpdateItems(ids, { archived: tab !== 'archived' });
                toast.success(tab === 'archived' ? 'Restored' : 'Archived');
                endSelect();
              }}
            >
              {tab === 'archived' ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              size="sm"
              disabled={!ids.length}
              icon={<Printer className="size-4" />}
              onClick={() => navigate(`/labels?ids=${ids.join(',')}`)}
            >
              Labels
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!ids.length}
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Delete ${ids.length} item${ids.length > 1 ? 's' : ''}?`,
                    message:
                      'Photos, sales, costs and repair parts attached to them are deleted too. Consider archiving instead.',
                    confirmLabel: 'Delete',
                    danger: true,
                  })
                ) {
                  await deleteItems(ids);
                  toast.success('Deleted');
                  endSelect();
                }
              }}
            >
              Delete
            </Button>
          </Card>
        )}

        {!data ? null : list.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Boxes />}
              title={counts.all ? 'No items match' : 'No items yet'}
              description={
                counts.all
                  ? 'Try a different tab, filter or search.'
                  : 'Add your first item — every item gets a unique ID you can print on a label.'
              }
              action={
                !counts.all && (
                  <ButtonLink to="/items/new" variant="primary" icon={<Plus className="size-4" />}>
                    New item
                  </ButtonLink>
                )
              }
            />
          </Card>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((i) => (
              <ItemCard
                key={i.id}
                item={i}
                fin={data.ledger.items.get(i.id)!}
                selecting={selecting}
                selected={selected.has(i.id)}
                onToggle={() => toggle(i.id)}
              />
            ))}
          </div>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {list.map((i) => (
              <ItemRow
                key={i.id}
                item={i}
                fin={data.ledger.items.get(i.id)!}
                compact={settings.density === 'compact'}
                selecting={selecting}
                selected={selected.has(i.id)}
                onToggle={() => toggle(i.id)}
              />
            ))}
          </Card>
        )}
        <p className="pb-2 text-center text-xs text-subtle">
          Values show {f.currency}. Profit is projected from list price/estimate for unsold items.
        </p>
      </Page>
    </>
  );
}

function ItemValue({ item, fin }: { item: Item; fin: ItemFinancials }) {
  const f = useFormat();
  const finished = !ACTIVE_ITEM_STATUSES.includes(item.status);
  const price = finished ? fin.revenue : expectedUnitPrice(item);
  const profit = fin.projectedProfit ?? (fin.soldQty ? fin.realizedProfit : null);
  return (
    <div className="tabular text-right">
      <div className="text-sm font-medium">
        {price !== null ? f.money(price) : <span className="text-subtle">No price</span>}
      </div>
      <div className="text-xs">
        {profit !== null ? (
          <MoneyTone value={profit}>{f.money(profit, { signed: true })}</MoneyTone>
        ) : (
          <span className="text-subtle">cost {f.money(fin.costBasis)}</span>
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  fin,
  compact,
  selecting,
  selected,
  onToggle,
}: {
  item: Item;
  fin: ItemFinancials;
  compact: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const content = (
    <>
      {selecting && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="size-4 accent-[var(--accent)]"
          aria-label="Select"
        />
      )}
      <Thumb imageId={item.primaryImageId} className={compact ? 'size-9' : 'size-12'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{item.name || 'Untitled'}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
          <span className="tabular">{item.code}</span>
          <ItemStatusBadge status={item.status} archived={item.archived} />
          {!compact && item.category && <span className="hidden sm:inline">{item.category}</span>}
          {!compact && item.storageLocation && (
            <span className="hidden md:inline">📍 {item.storageLocation}</span>
          )}
          {item.quantity > 1 && (
            <span>
              ×{fin.remainingQty}/{item.quantity}
            </span>
          )}
          {ACTIVE_ITEM_STATUSES.includes(item.status) && (
            <span className="hidden sm:inline">{fin.daysHeld}d</span>
          )}
        </div>
      </div>
      <ItemValue item={item} fin={fin} />
    </>
  );
  const cls = cn(
    'flex items-center gap-3 px-3 transition-colors hover:bg-surface-2',
    compact ? 'py-2' : 'py-3',
    selected && 'bg-accent/8',
  );
  return selecting ? (
    <button type="button" className={cn(cls, 'w-full text-left')} onClick={onToggle}>
      {content}
    </button>
  ) : (
    <Link to={`/items/${item.id}`} className={cls}>
      {content}
    </Link>
  );
}

function ItemCard({
  item,
  fin,
  selecting,
  selected,
  onToggle,
}: {
  item: Item;
  fin: ItemFinancials;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const body = (
    <Card
      className={cn('overflow-hidden transition-colors hover:border-accent/40', selected && 'border-accent')}
    >
      <Thumb imageId={item.primaryImageId} className="aspect-square w-full rounded-none" />
      <div className="space-y-1.5 p-3">
        <div className="truncate text-sm font-medium">{item.name || 'Untitled'}</div>
        <div className="flex items-center justify-between gap-2 text-xs text-subtle">
          <span className="tabular">{item.code}</span>
          <ItemStatusBadge status={item.status} />
        </div>
        <ItemValue item={item} fin={fin} />
      </div>
    </Card>
  );
  return selecting ? (
    <button type="button" onClick={onToggle} className="text-left">
      {body}
    </button>
  ) : (
    <Link to={`/items/${item.id}`}>{body}</Link>
  );
}
