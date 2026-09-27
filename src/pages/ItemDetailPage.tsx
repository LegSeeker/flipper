import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  Copy,
  MoreHorizontal,
  Pencil,
  Printer,
  Scissors,
  Tag,
  Trash2,
} from 'lucide-react';
import { db } from '@/db/db';
import { createProject, deleteItems, duplicateItem, updateItem } from '@/db/repo';
import { ACTIVE_ITEM_STATUSES, ITEM_STATUSES, type Item, type ItemStatus } from '@/db/schema';
import { useFormat, useSettings } from '@/app/context';
import { useLedger } from '@/app/data';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, KeyValue, MiniFigure, Section } from '@/components/ui/card';
import { Menu, Segmented } from '@/components/ui/segmented';
import { ITEM_STATUS_META, ItemStatusBadge, MoneyTone } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { ImageGallery, Thumb } from '@/components/images/images';
import { RequirementsList } from '@/components/requirements/RequirementsList';
import { ExpenseList } from '@/components/expenses/ExpenseList';
import { SalesList } from '@/components/sales/SalesList';
import { MarketPanel } from '@/components/ai/MarketPanel';
import { ListingPanel } from '@/components/ai/ListingPanel';
import { PartOutDialog } from '@/components/ai/PartOutDialog';
import { describeItem } from '@/ai/tasks';
import { expectedUnitPrice } from '@/lib/calc';
import { titleCase } from '@/lib/utils';

type Tab = 'overview' | 'money' | 'repair' | 'market' | 'listing';

export default function ItemDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const item = useLiveQuery(() => (id ? db.items.get(id) : undefined), [id]);
  const project = useLiveQuery(
    () => (item?.projectId ? db.projects.get(item.projectId) : undefined),
    [item?.projectId],
  );
  const parent = useLiveQuery(
    () => (item?.parentItemId ? db.items.get(item.parentItemId) : undefined),
    [item?.parentItemId],
  );
  const children = useLiveQuery(() => (id ? db.items.where('parentItemId').equals(id).toArray() : []), [id]);
  const reqCount = useLiveQuery(() => (id ? db.requirements.where('ownerId').equals(id).count() : 0), [id]);
  const data = useLedger();
  const f = useFormat();
  const settings = useSettings();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [partOut, setPartOut] = useState<{ projectId: string } | null>(null);

  if (item === undefined || !data) return null;
  if (!item) {
    return (
      <>
        <PageHeader title="Not found" back="/items" />
        <Page>
          <p className="text-muted">This item doesn't exist (it may have been deleted).</p>
        </Page>
      </>
    );
  }

  const fin = data.ledger.items.get(item.id)!;
  const active = ACTIVE_ITEM_STATUSES.includes(item.status);
  const unitPrice = expectedUnitPrice(item);
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  const setStatus = async (status: ItemStatus) => {
    await updateItem(item.id, { status });
    toast.success(`Marked as ${ITEM_STATUS_META[status].label.toLowerCase()}`);
  };

  const startPartOut = async () => {
    const ok = await confirm({
      title: 'Part out this item?',
      message: `A part-out project is created and this item's purchase cost (${f.money(item.purchasePrice + item.purchaseCosts)}) moves to the project, so it's shared across the parts you create.`,
      confirmLabel: 'Create part-out project',
    });
    if (!ok) return;
    const p = await createProject({
      name: `Part-out: ${item.name}`,
      type: 'part_out',
      status: 'active',
      description: [item.brand, item.model, item.description].filter(Boolean).join(' · '),
      purchasePrice: item.purchasePrice,
      purchaseCosts: item.purchaseCosts,
      purchaseDate: item.purchaseDate,
      purchaseSource: item.purchaseSource,
      primaryImageId: null,
    });
    await updateItem(item.id, { projectId: p.id, status: 'parted_out', purchasePrice: 0, purchaseCosts: 0 });
    toast.success(`Created ${p.code}`);
    setPartOut({ projectId: p.id });
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'money', label: 'Money' },
    { value: 'repair', label: `Repair${reqCount ? ` (${reqCount})` : ''}` },
    { value: 'market', label: 'Market' },
    { value: 'listing', label: 'Listing' },
  ];

  return (
    <>
      <PageHeader
        title={item.name || 'Untitled'}
        subtitle={
          <span className="tabular">
            {item.code}
            {project && ` · ${project.name}`}
          </span>
        }
        back
        actions={
          <>
            <ButtonLink to={`/items/${item.id}/edit`} variant="ghost" size="icon" aria-label="Edit">
              <Pencil className="size-5" />
            </ButtonLink>
            <Menu
              trigger={(t) => (
                <Button variant="ghost" size="icon" aria-label="More actions" onClick={t}>
                  <MoreHorizontal className="size-5" />
                </Button>
              )}
              items={[
                {
                  label: 'Print label',
                  icon: <Printer />,
                  onClick: () => navigate(`/labels?ids=${item.id}`),
                },
                {
                  label: 'Duplicate',
                  icon: <Copy />,
                  onClick: async () => {
                    const c = await duplicateItem(item.id);
                    toast.success(`Created ${c.code}`);
                    navigate(`/items/${c.id}/edit`);
                  },
                },
                active &&
                  item.status !== 'parted_out' && {
                    label: 'Part out into project…',
                    icon: <Scissors />,
                    onClick: startPartOut,
                  },
                {
                  label: item.archived ? 'Unarchive' : 'Archive',
                  icon: item.archived ? <ArchiveRestore /> : <Archive />,
                  onClick: () => updateItem(item.id, { archived: !item.archived }),
                },
                {
                  label: 'Delete',
                  icon: <Trash2 />,
                  danger: true,
                  onClick: async () => {
                    if (
                      await confirm({
                        title: `Delete ${item.code}?`,
                        message:
                          'Photos, sales, costs and repair parts for this item are deleted too. Archiving keeps history instead.',
                        confirmLabel: 'Delete',
                        danger: true,
                      })
                    ) {
                      await deleteItems([item.id]);
                      toast.success('Item deleted');
                      navigate('/items', { replace: true });
                    }
                  },
                },
              ]}
            />
          </>
        }
      />
      <Page>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-4">
            <Card className="p-4">
              <div className="flex gap-4">
                <Thumb imageId={item.primaryImageId} className="size-20 sm:size-24" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ItemStatusBadge status={item.status} archived={item.archived} />
                    {item.category && <span className="text-xs text-subtle">{item.category}</span>}
                    {item.quantity > 1 && (
                      <span className="text-xs text-subtle">
                        {fin.remainingQty} of {item.quantity} left
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={item.status}
                      onChange={(e) => setStatus(e.target.value as ItemStatus)}
                      className="h-9 w-auto"
                      aria-label="Status"
                    >
                      {ITEM_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {ITEM_STATUS_META[s].label}
                        </option>
                      ))}
                    </Select>
                    {active && fin.remainingQty > 0 && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Tag className="size-4" />}
                        onClick={() => setTab('money')}
                      >
                        Sell
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center lg:hidden">
                <MiniFigure label="Cost" value={f.money(fin.costBasis)} />
                <MiniFigure
                  label={active ? 'Value' : 'Revenue'}
                  value={f.money(active ? unitPrice : fin.revenue)}
                />
                <MiniFigure
                  label={fin.soldQty ? 'Profit' : 'Proj. profit'}
                  value={
                    <MoneyTone value={fin.soldQty ? fin.realizedProfit : fin.projectedProfit}>
                      {f.money(fin.soldQty ? fin.realizedProfit : fin.projectedProfit, { signed: true })}
                    </MoneyTone>
                  }
                />
              </div>
            </Card>

            <Segmented
              value={tab}
              onChange={setTab}
              options={tabs}
              className="sticky top-16 z-10 w-full lg:top-2"
            />

            {tab === 'overview' && (
              <>
                <Section title="Photos">
                  <ImageGallery ownerType="item" ownerId={item.id} primaryId={item.primaryImageId} />
                </Section>
                <Section
                  title="Details"
                  action={
                    <ButtonLink to={`/items/${item.id}/edit`} size="sm" variant="ghost">
                      Edit
                    </ButtonLink>
                  }
                >
                  <Details
                    item={item}
                    projectName={project ? `${project.code} · ${project.name}` : undefined}
                    parent={parent ?? undefined}
                  />
                </Section>
                {children && children.length > 0 && (
                  <Section title={`Parts from this item (${children.length})`}>
                    <ul className="divide-y divide-border">
                      {children.map((c) => (
                        <li key={c.id}>
                          <Link
                            to={`/items/${c.id}`}
                            className="flex items-center gap-3 py-2 text-sm hover:text-accent"
                          >
                            <span className="tabular w-20 text-xs text-subtle">{c.code}</span>
                            <span className="flex-1 truncate">{c.name}</span>
                            <ItemStatusBadge status={c.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}
              </>
            )}

            {tab === 'money' && (
              <>
                <Section title="Sales">
                  <SalesList itemId={item.id} canAdd={fin.remainingQty > 0 && item.status !== 'consumed'} />
                </Section>
                <Section
                  title="Extra costs"
                  description="Cleaning, testing, postage in, consumables — anything spent on this item."
                >
                  <ExpenseList ownerType="item" ownerId={item.id} />
                </Section>
              </>
            )}

            {tab === 'repair' && (
              <Section
                title="Repair parts & tasks"
                description="Track what's needed, what's ordered and what you already have. Needed parts appear on the shopping list."
              >
                <RequirementsList
                  ownerType="item"
                  ownerId={item.id}
                  subject={describeItem(item, settings.currency)}
                />
              </Section>
            )}

            {tab === 'market' && (
              <Section title="Market & pricing">
                <MarketPanel item={item} />
              </Section>
            )}

            {tab === 'listing' && (
              <Section title="Listing">
                <ListingPanel item={item} />
              </Section>
            )}
          </div>

          {/* Money summary */}
          <div className="space-y-4">
            <Card className="p-4 lg:sticky lg:top-4">
              <h2 className="mb-2 text-sm font-semibold">Profit</h2>
              <div className="mb-3">
                <MoneyTone
                  value={fin.soldQty ? fin.realizedProfit : fin.projectedProfit}
                  className="text-2xl font-semibold"
                >
                  {fin.soldQty
                    ? f.money(fin.realizedProfit, { signed: true })
                    : fin.projectedProfit !== null
                      ? f.money(fin.projectedProfit, { signed: true })
                      : '—'}
                </MoneyTone>
                <div className="text-xs text-subtle">
                  {fin.soldQty
                    ? `Realized on ${fin.soldQty} sold · margin ${f.pct(fin.margin)} · ROI ${f.pct(fin.roi)}`
                    : fin.projectedProfit !== null
                      ? `Projected at ${f.money(unitPrice)}${item.quantity > 1 ? '/unit' : ''} after est. fees`
                      : 'Set a list price or estimate to project profit'}
                </div>
              </div>
              <div className="divide-y divide-border">
                <KeyValue label="Purchase" value={f.money(fin.purchase)} />
                {fin.allocated !== 0 && (
                  <KeyValue label="Share of project cost" value={f.money(fin.allocated)} />
                )}
                {fin.expenses !== 0 && <KeyValue label="Extra costs" value={f.money(fin.expenses)} />}
                {fin.parts !== 0 && <KeyValue label="Repair parts" value={f.money(fin.parts)} />}
                <KeyValue
                  label={<b className="text-fg">Cost basis</b>}
                  value={<b>{f.money(fin.costBasis)}</b>}
                />
                {fin.pendingParts > 0 && (
                  <KeyValue
                    label="Parts still to buy"
                    value={<span className="text-warn">{f.money(fin.pendingParts)}</span>}
                  />
                )}
                {fin.revenue > 0 && (
                  <>
                    <KeyValue label="Revenue" value={f.money(fin.revenue)} />
                    <KeyValue label="Fees & postage" value={f.money(-fin.sellingCosts)} />
                  </>
                )}
                <KeyValue
                  label={`List price${item.quantity > 1 ? ' (unit)' : ''}`}
                  value={f.money(item.listPrice)}
                />
                <KeyValue label="Estimated value" value={f.money(item.estimatedValue)} />
                <KeyValue
                  label={active ? 'Days held' : 'Days to sell'}
                  value={active ? fin.daysHeld : (fin.daysToSell ?? '—')}
                />
              </div>
            </Card>
          </div>
        </div>
      </Page>
      {partOut && (
        <PartOutDialog
          open
          onClose={() => {
            const pid = partOut.projectId;
            setPartOut(null);
            navigate(`/projects/${pid}`);
          }}
          projectId={partOut.projectId}
          parentItemId={item.id}
          source={{
            name: item.name,
            description: [item.brand, item.model, item.description].filter(Boolean).join(' · '),
            purchasePrice: fin.purchase,
          }}
        />
      )}
    </>
  );
}

function Details({ item, projectName, parent }: { item: Item; projectName?: string; parent?: Item }) {
  const f = useFormat();
  const settings = useSettings();
  const rows: [string, ReactNode][] = [
    ['Brand', item.brand],
    ['Model', item.model],
    ['Condition', titleCase(item.condition)],
    ['Quantity', item.quantity > 1 ? item.quantity : ''],
    ['Location', item.storageLocation],
    [
      'Project',
      projectName && (
        <Link className="text-accent" to={`/projects/${item.projectId}`}>
          {projectName}
        </Link>
      ),
    ],
    [
      'Parted from',
      parent && (
        <Link className="text-accent" to={`/items/${parent.id}`}>
          {parent.code} · {parent.name}
        </Link>
      ),
    ],
    [
      'Purchased',
      item.purchaseDate
        ? `${f.date(item.purchaseDate)}${item.purchaseSource ? ` · ${item.purchaseSource}` : ''}`
        : item.purchaseSource,
    ],
    [
      'Listed',
      item.listedAt
        ? `${f.date(item.listedAt)}${item.listingPlatform ? ` · ${item.listingPlatform}` : ''}`
        : item.listingPlatform,
    ],
    [
      'Listing',
      item.listingUrl && (
        <a className="text-accent" href={item.listingUrl} target="_blank" rel="noreferrer noopener">
          Open listing
        </a>
      ),
    ],
    ['Barcode / serial', item.barcode],
    ['Weight', item.weight ? `${item.weight} ${settings.weightUnit}` : ''],
    ['Dimensions', item.dimensions],
    ['Tags', item.tags.join(', ')],
    ['Finished', item.finishedAt ? f.date(item.finishedAt) : ''],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {rows
          .filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false)
          .map(([k, v]) => (
            <KeyValue key={k} label={k} value={v} className="border-b border-border/60" />
          ))}
      </div>
      {item.description && <p className="text-sm whitespace-pre-line text-muted">{item.description}</p>}
      {item.notes && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm whitespace-pre-line text-muted">
          <div className="mb-1 text-xs font-medium text-subtle">Notes</div>
          {item.notes}
        </div>
      )}
    </div>
  );
}
