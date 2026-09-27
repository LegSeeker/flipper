import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Link2,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { db } from '@/db/db';
import { deleteProject, updateItem, updateProject } from '@/db/repo';
import { ALLOCATION_METHODS, type AllocationMethod, type Item } from '@/db/schema';
import { useFormat, useSettings } from '@/app/context';
import { useLedger } from '@/app/data';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, KeyValue, MiniFigure, Progress, Section } from '@/components/ui/card';
import { Menu, Segmented } from '@/components/ui/segmented';
import {
  ALLOCATION_HELP,
  Badge,
  ItemStatusBadge,
  MoneyTone,
  PROJECT_STATUS_META,
  PROJECT_TYPE_LABEL,
} from '@/components/ui/badge';
import { Modal, useConfirm } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { ImageGallery, Thumb } from '@/components/images/images';
import { RequirementsList } from '@/components/requirements/RequirementsList';
import { ExpenseList } from '@/components/expenses/ExpenseList';
import { PartOutDialog } from '@/components/ai/PartOutDialog';
import { ItemPicker } from '@/components/items/ItemPicker';
import { projectBrief } from '@/ai/tasks';
import { expectedUnitPrice, type ItemFinancials } from '@/lib/calc';

type Tab = 'items' | 'repair' | 'costs' | 'photos';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useLiveQuery(() => (id ? db.projects.get(id) : undefined), [id]);
  const data = useLedger();
  const f = useFormat();
  const settings = useSettings();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [partOutOpen, setPartOutOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const defaultTab: Tab = project?.type === 'repair' ? 'repair' : 'items';
  const tab = (params.get('tab') as Tab) || defaultTab;

  if (project === undefined || !data) return null;
  if (!project) {
    return (
      <>
        <PageHeader title="Not found" back="/projects" />
        <Page>
          <p className="text-muted">This project doesn't exist.</p>
        </Page>
      </>
    );
  }

  const fin = data.ledger.projects.get(project.id)!;
  const items = data.ds.items
    .filter((i) => i.projectId === project.id)
    .sort((a, b) => a.code.localeCompare(b.code));
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };
  const recovered = fin.recovered ?? 0;

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={
          <span className="tabular">
            {project.code} · {PROJECT_TYPE_LABEL[project.type]}
          </span>
        }
        back
        actions={
          <>
            <ButtonLink to={`/projects/${project.id}/edit`} variant="ghost" size="icon" aria-label="Edit">
              <Pencil className="size-5" />
            </ButtonLink>
            <Menu
              trigger={(t) => (
                <Button variant="ghost" size="icon" aria-label="More actions" onClick={t}>
                  <MoreHorizontal className="size-5" />
                </Button>
              )}
              items={[
                project.status !== 'finished'
                  ? {
                      label: 'Mark finished',
                      icon: <CheckCircle2 />,
                      onClick: () => updateProject(project.id, { status: 'finished' }),
                    }
                  : {
                      label: 'Reopen',
                      icon: <RotateCcw />,
                      onClick: () => updateProject(project.id, { status: 'active' }),
                    },
                {
                  label: project.archived ? 'Unarchive' : 'Archive',
                  icon: project.archived ? <ArchiveRestore /> : <Archive />,
                  onClick: () => updateProject(project.id, { archived: !project.archived }),
                },
                items.length > 0 && {
                  label: 'Print labels for items',
                  icon: <Printer />,
                  onClick: () => navigate(`/labels?ids=${items.map((i) => i.id).join(',')}`),
                },
                {
                  label: 'Delete project',
                  icon: <Trash2 />,
                  danger: true,
                  onClick: () => setDeleteOpen(true),
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
                <Thumb imageId={project.primaryImageId} className="size-16 sm:size-20" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={PROJECT_STATUS_META[project.status].tone}>
                      {PROJECT_STATUS_META[project.status].label}
                    </Badge>
                    {project.archived && <Badge>Archived</Badge>}
                    {project.deadline && <Badge tone="warn">Due {f.date(project.deadline)}</Badge>}
                  </div>
                  {project.description && (
                    <p className="mt-2 line-clamp-3 text-sm whitespace-pre-line text-muted">
                      {project.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-subtle">
                  <span>Break-even progress</span>
                  <span>
                    {f.money(fin.netProceeds)} / {f.money(fin.totalCost)}
                  </span>
                </div>
                <Progress value={recovered} tone={recovered >= 1 ? 'profit' : 'accent'} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center lg:hidden">
                <MiniFigure label="Total cost" value={f.money(fin.totalCost)} />
                <MiniFigure
                  label="Profit so far"
                  value={<MoneyTone value={fin.profit}>{f.money(fin.profit, { signed: true })}</MoneyTone>}
                />
                <MiniFigure
                  label="Projected"
                  value={
                    <MoneyTone value={fin.projectedProfit}>
                      {f.money(fin.projectedProfit, { signed: true })}
                    </MoneyTone>
                  }
                />
              </div>
            </Card>

            <Segmented
              value={tab}
              onChange={setTab}
              className="sticky top-16 z-10 w-full lg:top-2"
              options={[
                { value: 'items', label: `Items (${items.length})` },
                { value: 'repair', label: 'Parts needed' },
                { value: 'costs', label: 'Costs' },
                { value: 'photos', label: 'Photos & notes' },
              ]}
            />

            {tab === 'items' && (
              <Section
                title="Items"
                description={
                  project.type === 'part_out'
                    ? 'Each part is its own item with an ID. The project cost is shared across them.'
                    : 'Items in this project share its costs.'
                }
                action={
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLinkOpen(true)}
                      icon={<Link2 className="size-4" />}
                    >
                      <span className="hidden sm:inline">Add existing</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setPartOutOpen(true)}
                      icon={<ListPlus className="size-4" />}
                    >
                      {project.type === 'part_out' ? 'Add parts' : 'Bulk add'}
                    </Button>
                    <ButtonLink
                      size="sm"
                      variant="primary"
                      to={`/items/new?project=${project.id}`}
                      icon={<Plus className="size-4" />}
                    >
                      <span className="hidden sm:inline">New item</span>
                    </ButtonLink>
                  </>
                }
              >
                {items.length ? (
                  <ul className="divide-y divide-border">
                    {items.map((i) => (
                      <ProjectItemRow
                        key={i.id}
                        item={i}
                        allocated={data.ledger.allocations.get(i.id) ?? 0}
                        profit={data.ledger.items.get(i.id)!}
                      />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title="No items yet"
                    description={
                      project.type === 'part_out'
                        ? 'Use “Add parts” to get AI suggestions for what to sell, or paste your own list.'
                        : 'Add the item(s) this project is about.'
                    }
                  />
                )}
                <div className="mt-4 rounded-xl bg-surface-2 p-3">
                  <Field label="Share project costs" hint={ALLOCATION_HELP[project.allocation]}>
                    <Select
                      value={project.allocation}
                      onChange={(e) =>
                        updateProject(project.id, { allocation: e.target.value as AllocationMethod })
                      }
                      className="h-9"
                    >
                      {ALLOCATION_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m === 'value' ? 'By value' : m === 'equal' ? 'Equally per unit' : 'Manually'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {Math.abs(fin.unallocated) >= 0.01 && items.length > 0 && (
                    <p className="mt-2 text-xs text-warn">
                      {f.money(fin.unallocated)} of shared cost isn't assigned to any item yet.
                    </p>
                  )}
                </div>
              </Section>
            )}

            {tab === 'repair' && (
              <Section
                title="Parts & tasks needed"
                description="Parts you have, need to buy or have ordered. Needed parts show on the shopping list."
              >
                <RequirementsList
                  ownerType="project"
                  ownerId={project.id}
                  subject={projectBrief(
                    project,
                    items.map((i) => i.name),
                    settings.currency,
                  )}
                />
              </Section>
            )}

            {tab === 'costs' && (
              <Section
                title="Project costs"
                description="Costs for the whole project (transport, tools, consumables). Shared across items."
              >
                <ExpenseList ownerType="project" ownerId={project.id} />
              </Section>
            )}

            {tab === 'photos' && (
              <>
                <Section title="Photos">
                  <ImageGallery ownerType="project" ownerId={project.id} primaryId={project.primaryImageId} />
                </Section>
                {project.notes && (
                  <Section title="Notes">
                    <p className="text-sm whitespace-pre-line text-muted">{project.notes}</p>
                  </Section>
                )}
              </>
            )}
          </div>

          <div className="space-y-4">
            <Card className="p-4 lg:sticky lg:top-4">
              <h2 className="mb-2 text-sm font-semibold">Profit</h2>
              <MoneyTone value={fin.profit} className="text-2xl font-semibold">
                {f.money(fin.profit, { signed: true })}
              </MoneyTone>
              <div className="text-xs text-subtle">
                So far · projected {f.money(fin.projectedProfit, { signed: true })} if the rest sells at
                list/estimate
              </div>
              <div className="mt-3 divide-y divide-border">
                <KeyValue label="Purchase" value={f.money(fin.acquisition)} />
                {fin.projectExpenses !== 0 && (
                  <KeyValue label="Project costs" value={f.money(fin.projectExpenses)} />
                )}
                {fin.projectParts !== 0 && (
                  <KeyValue label="Project parts" value={f.money(fin.projectParts)} />
                )}
                {fin.itemOwnCosts !== 0 && <KeyValue label="Item costs" value={f.money(fin.itemOwnCosts)} />}
                <KeyValue
                  label={<b className="text-fg">Total cost</b>}
                  value={<b>{f.money(fin.totalCost)}</b>}
                />
                <KeyValue label="Revenue" value={f.money(fin.revenue)} />
                <KeyValue label="Fees & postage" value={f.money(-fin.sellingCosts)} />
                <KeyValue label="Unsold (est.)" value={f.money(fin.unsoldValue)} />
                <KeyValue label="Units sold" value={`${fin.unitsSold} / ${fin.unitsTotal}`} />
                {fin.pendingParts > 0 && (
                  <KeyValue
                    label="Parts to buy"
                    value={<span className="text-warn">{f.money(fin.pendingParts)}</span>}
                  />
                )}
                {project.budget ? <KeyValue label="Budget used" value={f.pct(fin.budgetUsed)} /> : null}
                {project.targetProfit ? (
                  <KeyValue label="Target profit" value={f.money(project.targetProfit)} />
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      </Page>

      <PartOutDialog
        open={partOutOpen}
        onClose={() => setPartOutOpen(false)}
        projectId={project.id}
        source={{ name: project.name, description: project.description, purchasePrice: fin.acquisition }}
      />

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Add existing item" size="sm">
        <ItemPicker
          value={null}
          filter={(i) => i.projectId !== project.id}
          onChange={async (it) => {
            if (!it) return;
            await updateItem(it.id, { projectId: project.id });
            toast.success(`${it.code} added to project`);
            setLinkOpen(false);
          }}
        />
        <p className="mt-2 text-xs text-subtle">
          The item keeps its own purchase cost and also takes a share of the project cost.
        </p>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${project.code}?`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await deleteProject(project.id, { deleteItems: false });
                toast.success('Project deleted — items kept');
                navigate('/projects', { replace: true });
              }}
            >
              Delete, keep items
            </Button>
            {items.length > 0 && (
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Also delete ${items.length} items?`,
                      message: 'This cannot be undone.',
                      danger: true,
                      confirmLabel: 'Delete everything',
                    })
                  ) {
                    await deleteProject(project.id, { deleteItems: true });
                    toast.success('Project and items deleted');
                    navigate('/projects', { replace: true });
                  }
                }}
              >
                Delete with items
              </Button>
            )}
          </>
        }
      >
        <p className="text-sm text-muted">
          Project costs, parts list and photos are removed. You can keep its {items.length} items (they become
          standalone) or delete them too. Archiving keeps everything.
        </p>
      </Modal>
    </>
  );
}

function ProjectItemRow({
  item,
  allocated,
  profit,
}: {
  item: Item;
  allocated: number;
  profit: ItemFinancials;
}) {
  const f = useFormat();
  const value = expectedUnitPrice(item);
  const result = profit.soldQty ? profit.realizedProfit : profit.projectedProfit;
  return (
    <li>
      <Link to={`/items/${item.id}`} className="flex items-center gap-3 py-2.5 hover:text-accent">
        <Thumb imageId={item.primaryImageId} className="size-10" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">
            {item.quantity > 1 && <span className="text-subtle">{item.quantity}× </span>}
            {item.name}
          </div>
          <div className="flex items-center gap-2 text-xs text-subtle">
            <span className="tabular">{item.code}</span>
            <ItemStatusBadge status={item.status} />
            {allocated > 0 && <span className="hidden sm:inline">cost share {f.money(allocated)}</span>}
          </div>
        </div>
        <div className="tabular text-right text-sm">
          <div>
            {profit.revenue ? f.money(profit.revenue) : value !== null ? f.money(value * item.quantity) : '—'}
          </div>
          {result !== null && (
            <MoneyTone value={result} className="text-xs">
              {f.money(result, { signed: true })}
            </MoneyTone>
          )}
        </div>
      </Link>
    </li>
  );
}
