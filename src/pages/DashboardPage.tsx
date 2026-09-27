import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Boxes,
  Camera,
  ChevronRight,
  TrendingUp,
  Clock,
  FolderKanban,
  Plus,
  ShoppingCart,
  Sparkles,
  Tag,
  Wrench,
} from 'lucide-react';
import { db } from '@/db/db';
import { loadDemoData } from '@/db/demo';
import { useAiContext, useFormat, useSettings } from '@/app/context';
import { useImageOwners, useLedger } from '@/app/data';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, Section, Stat } from '@/components/ui/card';
import { MoneyTone } from '@/components/ui/badge';
import { MonthlyColumns } from '@/components/charts/charts';
import { Thumb } from '@/components/images/images';
import { buildReport, inventorySnapshot } from '@/lib/stats';
import { pendingPartsCost } from '@/lib/calc';
import { daysBetween, periodRange } from '@/lib/dates';
import { errorMessage } from '@/lib/utils';
import type { Item } from '@/db/schema';

export default function DashboardPage() {
  const data = useLedger();
  const owners = useImageOwners();
  const settings = useSettings();
  const ai = useAiContext();
  const f = useFormat();
  const navigate = useNavigate();
  const [loadingDemo, setLoadingDemo] = useState(false);
  const recentSales = useLiveQuery(() => db.sales.orderBy('date').reverse().limit(6).toArray(), []);

  const month = useMemo(
    () => (data ? buildReport(data.ds, data.ledger, periodRange('month')) : null),
    [data],
  );
  const year = useMemo(() => (data ? buildReport(data.ds, data.ledger, periodRange('12m')) : null), [data]);
  const snap = useMemo(
    () => (data && owners ? inventorySnapshot(data.ds, data.ledger, settings, owners) : null),
    [data, owners, settings],
  );

  if (!data || !month || !year || !snap) return null;

  const neededParts = data.ds.requirements.filter((r) => r.status === 'needed' && !r.inventoryItemId);
  const empty = data.ds.items.length === 0 && data.ds.projects.length === 0;
  const itemsById = new Map(data.ds.items.map((i) => [i.id, i]));

  const demo = async () => {
    setLoadingDemo(true);
    try {
      await loadDemoData();
      toast.success('Demo data loaded — everything is tagged "demo"');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={new Intl.DateTimeFormat(f.locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        }).format(new Date())}
      />
      <Page>
        {empty && (
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-accent/20 via-accent/5 to-transparent p-5">
              <h2 className="text-lg font-semibold">Welcome to Flipper 👋</h2>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Track what you buy, repair, part out and sell. Every item gets an ID, costs are shared across
                projects automatically, and profit is worked out for you. Your data stays on this device
                unless you turn on Google Drive sync.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ButtonLink to="/items/new" variant="primary" icon={<Plus className="size-4" />}>
                  Add first item
                </ButtonLink>
                <ButtonLink to="/projects/new" icon={<FolderKanban className="size-4" />}>
                  Start a project
                </ButtonLink>
                <Button onClick={demo} loading={loadingDemo}>
                  Load demo data
                </Button>
                {!ai.configured && (
                  <ButtonLink to="/settings#ai" variant="ghost" icon={<Sparkles className="size-4" />}>
                    Set up AI
                  </ButtonLink>
                )}
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Profit this month"
            value={f.money(month.netProfit)}
            tone={month.netProfit >= 0 ? 'profit' : 'loss'}
            sub={`${month.salesCount} sales · ${f.money(month.revenue)} revenue`}
            icon={<TrendingUp className="size-4" />}
          />
          <Stat
            label="Profit last 12 months"
            value={f.money(year.netProfit)}
            tone={year.netProfit >= 0 ? 'profit' : 'loss'}
            sub={`Margin ${f.pct(year.margin)}`}
            icon={<TrendingUp className="size-4" />}
          />
          <Stat
            label="Stock value"
            value={f.money(snap.costValue)}
            sub={`${snap.units} units at cost`}
            icon={<Boxes className="size-4" />}
          />
          <Stat
            label="Potential profit"
            value={f.money(snap.potentialProfit)}
            tone={snap.potentialProfit >= 0 ? 'profit' : 'loss'}
            sub={`if stock sells at est. value`}
            icon={<Tag className="size-4" />}
          />
        </div>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <MiniLink to="/items?tab=active&status=listed" label="Listed" value={snap.listed} />
          <MiniLink to="/items?tab=active&status=in_repair" label="In repair" value={snap.inRepair} />
          <MiniLink
            to="/items?tab=active&status=in_stock"
            label="Not listed"
            value={data.ds.items.filter((i) => !i.archived && i.status === 'in_stock').length}
          />
          <MiniLink to="/items?tab=active&status=sourcing" label="To buy" value={snap.sourcing} />
          <MiniLink to="/projects" label="Projects" value={snap.activeProjects} />
          <MiniLink to="/shopping" label="Parts to buy" value={neededParts.length} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          <Section
            title="Net profit by month"
            description="Last 12 months"
            action={
              <ButtonLink to="/reports" size="sm" variant="ghost">
                Reports
              </ButtonLink>
            }
          >
            <MonthlyColumns
              data={year.monthly}
              series={[{ key: 'netProfit', label: 'Net profit', color: 'var(--series-1)' }]}
              height={200}
            />
          </Section>

          <Section title="Needs attention">
            <ul className="space-y-1">
              <Attention
                icon={<Clock />}
                to="/items?tab=active&status=listed&sort=held"
                count={snap.stale.length}
                text={`listed over ${settings.staleDays} days — consider a price drop`}
              />
              <Attention
                icon={<Camera />}
                to="/items?tab=active"
                count={snap.missingPhotos.length}
                text="items without photos"
              />
              <Attention
                icon={<Tag />}
                to="/items?tab=active&sort=value"
                count={snap.missingPrice.length}
                text="items without a price or estimate"
              />
              <Attention
                icon={<ShoppingCart />}
                to="/shopping"
                count={neededParts.length}
                text={`parts to buy (~${f.money(pendingPartsCost(neededParts))})`}
              />
              <Attention
                icon={<Wrench />}
                to="/items?tab=active&status=in_repair"
                count={snap.inRepair}
                text="items in repair"
              />
            </ul>
            {snap.stale.length +
              snap.missingPhotos.length +
              snap.missingPrice.length +
              neededParts.length +
              snap.inRepair ===
              0 && <p className="py-4 text-center text-sm text-subtle">All clear ✨</p>}
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            title="Recent sales"
            action={
              <ButtonLink to="/reports" size="sm" variant="ghost">
                All
              </ButtonLink>
            }
          >
            {recentSales?.length ? (
              <ul className="divide-y divide-border">
                {recentSales.map((s) => {
                  const it = itemsById.get(s.itemId);
                  const fin = data.ledger.items.get(s.itemId);
                  const profit =
                    s.price + s.shippingCharged - s.fees - s.shippingCost - (fin?.unitCost ?? 0) * s.quantity;
                  return (
                    <li key={s.id}>
                      <Link
                        to={`/items/${s.itemId}`}
                        className="flex items-center gap-3 py-2 text-sm hover:text-accent"
                      >
                        <Thumb imageId={it?.primaryImageId} className="size-9" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{it?.name ?? 'Deleted item'}</span>
                          <span className="block text-xs text-subtle">{f.date(s.date)}</span>
                        </span>
                        <span className="tabular text-right">
                          <span className="block">{f.money(s.price + s.shippingCharged)}</span>
                          <MoneyTone value={profit} className="block text-xs">
                            {f.money(profit, { signed: true })}
                          </MoneyTone>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-subtle">No sales yet.</p>
            )}
          </Section>

          <Section title="Oldest stock" description="Longest held, still unsold">
            <OldestStock items={data.ds.items} />
          </Section>
        </div>

        {!ai.configured && !empty && (
          <Card className="flex items-center gap-3 p-4">
            <Sparkles className="size-5 shrink-0 text-accent" />
            <p className="flex-1 text-sm text-muted">
              Add a DeepSeek API key to get pricing, listing writing, part-out lists and repair plans.
            </p>
            <Button size="sm" onClick={() => navigate('/settings#ai')}>
              Set up
            </Button>
          </Card>
        )}
      </Page>
    </>
  );
}

function MiniLink({ to, label, value }: { to: string; label: string; value: number }) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-border bg-surface px-3 py-2.5 transition-colors hover:border-accent/40"
    >
      <div className="text-lg font-semibold">{value}</div>
      <div className="truncate text-xs text-subtle">{label}</div>
    </Link>
  );
}

function Attention({ icon, to, count, text }: { icon: ReactNode; to: string; count: number; text: string }) {
  if (!count) return null;
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-surface-2">
        <span className="grid size-8 place-items-center rounded-lg bg-warn/12 text-warn [&>svg]:size-4">
          {icon}
        </span>
        <span className="flex-1">
          <b>{count}</b> <span className="text-muted">{text}</span>
        </span>
        <ChevronRight className="size-4 text-subtle" />
      </Link>
    </li>
  );
}

function OldestStock({ items }: { items: readonly Item[] }) {
  const f = useFormat();
  const list = items
    .filter((i) => !i.archived && ['in_stock', 'listed', 'in_repair'].includes(i.status))
    .map((i) => ({ i, days: daysBetween(i.purchaseDate ?? new Date(i.createdAt)) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);
  if (!list.length)
    return (
      <p className="flex items-center justify-center gap-2 py-6 text-sm text-subtle">
        <AlertTriangle className="size-4" /> Nothing in stock
      </p>
    );
  return (
    <ul className="divide-y divide-border">
      {list.map(({ i, days }) => (
        <li key={i.id}>
          <Link to={`/items/${i.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-accent">
            <Thumb imageId={i.primaryImageId} className="size-9" />
            <span className="min-w-0 flex-1 truncate">{i.name}</span>
            <span className="tabular text-xs text-subtle">{days}d</span>
            <span className="tabular w-20 text-right">{f.money(i.listPrice ?? i.estimatedValue)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
