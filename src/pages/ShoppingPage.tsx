import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, Copy, ExternalLink, PackageCheck, ShoppingCart, Truck } from 'lucide-react';
import { updateRequirement } from '@/db/repo';
import type { Requirement } from '@/db/schema';
import { useFormat } from '@/app/context';
import { useDataset } from '@/app/data';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Section } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { Badge, REQUIREMENT_STATUS_META } from '@/components/ui/badge';
import { Modal } from '@/components/ui/dialog';
import { MoneyField } from '@/components/ui/field';
import { copyText } from '@/lib/utils';
import { round2 } from '@/lib/money';

type Filter = 'needed' | 'ordered' | 'open';

export default function ShoppingPage() {
  const ds = useDataset();
  const f = useFormat();
  const [filter, setFilter] = useState<Filter>('needed');
  const [receiving, setReceiving] = useState<Requirement | null>(null);

  const groups = useMemo(() => {
    if (!ds) return [];
    const items = new Map(ds.items.map((i) => [i.id, i]));
    const projects = new Map(ds.projects.map((p) => [p.id, p]));
    const open = ds.requirements.filter(
      (r) =>
        !r.inventoryItemId &&
        (filter === 'open' ? r.status === 'needed' || r.status === 'ordered' : r.status === filter),
    );
    const byOwner = new Map<string, { title: string; code: string; link: string; reqs: Requirement[] }>();
    for (const r of open) {
      const owner = r.ownerType === 'item' ? items.get(r.ownerId) : projects.get(r.ownerId);
      if (!owner || owner.archived) continue;
      const key = `${r.ownerType}:${r.ownerId}`;
      const g = byOwner.get(key) ?? {
        title: owner.name,
        code: owner.code,
        link: `/${r.ownerType === 'item' ? 'items' : 'projects'}/${owner.id}?tab=repair`,
        reqs: [],
      };
      g.reqs.push(r);
      byOwner.set(key, g);
    }
    const prio = { high: 0, normal: 1, low: 2 };
    return [...byOwner.values()].map((g) => ({
      ...g,
      reqs: g.reqs.sort((a, b) => prio[a.priority] - prio[b.priority]),
    }));
  }, [ds, filter]);

  const sourcing = useMemo(
    () => (ds?.items ?? []).filter((i) => i.status === 'sourcing' && !i.archived),
    [ds],
  );
  const total = groups.reduce((s, g) => s + g.reqs.reduce((t, r) => t + (r.estimatedCost ?? 0), 0), 0);
  const count = groups.reduce((s, g) => s + g.reqs.length, 0);

  const copyList = async () => {
    const text = groups
      .map((g) =>
        [
          `${g.code} ${g.title}`,
          ...g.reqs.map(
            (r) =>
              `  [ ] ${r.quantity > 1 ? `${r.quantity}× ` : ''}${r.name}${r.estimatedCost ? ` (~${f.money(r.estimatedCost)})` : ''}${r.url ? ` ${r.url}` : ''}`,
          ),
        ].join('\n'),
      )
      .join('\n\n');
    if (await copyText(text)) toast.success('Shopping list copied');
  };

  return (
    <>
      <PageHeader
        title="Shopping list"
        subtitle={`${count} parts · ~${f.money(total)}`}
        actions={
          <Button variant="ghost" size="icon" aria-label="Copy list" onClick={copyList} disabled={!count}>
            <Copy className="size-5" />
          </Button>
        }
      />
      <Page>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'needed', label: 'To buy' },
            { value: 'ordered', label: 'Ordered' },
            { value: 'open', label: 'All open' },
          ]}
        />
        {!groups.length ? (
          <Card>
            <EmptyState
              icon={<ShoppingCart />}
              title="Nothing to buy"
              description="Parts marked “Need to buy” on items and projects appear here, grouped by what they're for."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {groups.map((g) => (
              <Section
                key={g.link}
                title={
                  <Link to={g.link} className="hover:text-accent">
                    <span className="tabular mr-2 text-xs text-subtle">{g.code}</span>
                    {g.title}
                  </Link>
                }
              >
                <ul className="divide-y divide-border">
                  {g.reqs.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">
                          {r.quantity > 1 && <span className="text-subtle">{r.quantity}× </span>}
                          {r.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                          <Badge tone={REQUIREMENT_STATUS_META[r.status].tone}>
                            {REQUIREMENT_STATUS_META[r.status].label}
                          </Badge>
                          {r.priority === 'high' && <Badge tone="loss">High priority</Badge>}
                          {r.supplier && <span>{r.supplier}</span>}
                          {r.estimatedCost !== null && (
                            <span className="tabular">~{f.money(r.estimatedCost)}</span>
                          )}
                        </div>
                      </div>
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="p-2 text-subtle hover:text-accent"
                          aria-label="Open link"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      )}
                      {r.status === 'needed' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Truck className="size-4" />}
                          onClick={() => updateRequirement(r.id, { status: 'ordered' })}
                        >
                          <span className="hidden sm:inline">Ordered</span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        icon={<PackageCheck className="size-4" />}
                        onClick={() => setReceiving(r)}
                      >
                        <span className="hidden sm:inline">Got it</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </div>
        )}

        {sourcing.length > 0 && (
          <Section
            title="Stock to source"
            description="Items marked “To buy” — things you're looking out for to resell."
          >
            <ul className="divide-y divide-border">
              {sourcing.map((i) => (
                <li key={i.id}>
                  <Link
                    to={`/items/${i.id}`}
                    className="flex items-center gap-3 py-2 text-sm hover:text-accent"
                  >
                    <span className="tabular w-20 text-xs text-subtle">{i.code}</span>
                    <span className="flex-1 truncate">{i.name}</span>
                    {i.estimatedValue !== null && (
                      <span className="tabular text-xs text-subtle">worth ~{f.money(i.estimatedValue)}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Page>
      <ReceiveDialog req={receiving} onClose={() => setReceiving(null)} />
    </>
  );
}

function ReceiveDialog({ req, onClose }: { req: Requirement | null; onClose: () => void }) {
  const [cost, setCost] = useState<number | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (req && req.id !== lastId) {
    setLastId(req.id);
    setCost(req.actualCost ?? req.estimatedCost);
  }
  const save = async () => {
    if (!req) return;
    await updateRequirement(req.id, { status: 'in_stock', actualCost: cost !== null ? round2(cost) : null });
    toast.success('Marked as received');
    onClose();
  };
  return (
    <Modal
      open={Boolean(req)}
      onClose={onClose}
      title="Part received"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} icon={<CheckCircle2 className="size-4" />}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">{req?.name}</p>
      <MoneyField
        label="What did it cost in total?"
        value={cost}
        onChange={setCost}
        hint="Added to the item/project cost basis"
      />
    </Modal>
  );
}
