import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FolderKanban, Plus, Search } from 'lucide-react';
import { PROJECT_TYPES, type Project } from '@/db/schema';
import { useFormat } from '@/app/context';
import { useLedger } from '@/app/data';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, Progress } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { inputClass, Select } from '@/components/ui/field';
import { Badge, MoneyTone, PROJECT_STATUS_META, PROJECT_TYPE_LABEL } from '@/components/ui/badge';
import { Thumb } from '@/components/images/images';
import { matches } from '@/components/layout/SearchDialog';
import type { ProjectFinancials } from '@/lib/calc';
import { cn } from '@/lib/utils';

type Tab = 'active' | 'finished' | 'archived' | 'all';

function lifecycle(p: Project): Exclude<Tab, 'all'> {
  if (p.archived) return 'archived';
  return p.status === 'finished' ? 'finished' : 'active';
}

export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'active';
  const type = params.get('type') ?? '';
  const q = params.get('q') ?? '';
  const data = useLedger();

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const counts = useMemo(() => {
    const c = { active: 0, finished: 0, archived: 0, all: 0 };
    for (const p of data?.ds.projects ?? []) {
      c[lifecycle(p)]++;
      c.all++;
    }
    return c;
  }, [data]);

  const list = useMemo(
    () =>
      (data?.ds.projects ?? [])
        .filter(
          (p) =>
            (tab === 'all' || lifecycle(p) === tab) &&
            (!type || p.type === type) &&
            (!q || matches(q, p.code, p.name, p.description, p.tags.join(' '))),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [data, tab, type, q],
  );

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Part-outs, repairs, bundles and flips"
        actions={
          <ButtonLink to="/projects/new" variant="primary" icon={<Plus className="size-4" />}>
            <span className="hidden sm:inline">New project</span>
          </ButtonLink>
        }
      />
      <Page>
        <Segmented
          value={tab}
          onChange={(v) => setParam('tab', v)}
          options={[
            { value: 'active', label: 'Active', count: counts.active },
            { value: 'finished', label: 'Finished', count: counts.finished },
            { value: 'archived', label: 'Archived', count: counts.archived },
            { value: 'all', label: 'All', count: counts.all },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={q}
              onChange={(e) => setParam('q', e.target.value)}
              placeholder="Search projects…"
              className={cn(inputClass, 'h-10 pl-9')}
            />
          </div>
          <Select
            value={type}
            onChange={(e) => setParam('type', e.target.value)}
            className="w-auto flex-none"
            aria-label="Type"
          >
            <option value="">All types</option>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROJECT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>

        {data && !list.length ? (
          <Card>
            <EmptyState
              icon={<FolderKanban />}
              title={counts.all ? 'No projects match' : 'No projects yet'}
              description="Projects group items: break a car or laptop for parts, repair something for resale, or split a bulk lot — costs are shared across the items automatically."
              action={
                <ButtonLink to="/projects/new" variant="primary" icon={<Plus className="size-4" />}>
                  New project
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => (
              <ProjectCard key={p.id} project={p} fin={data!.ledger.projects.get(p.id)!} />
            ))}
          </div>
        )}
      </Page>
    </>
  );
}

function ProjectCard({ project: p, fin }: { project: Project; fin: ProjectFinancials }) {
  const f = useFormat();
  const recovered = fin.recovered ?? 0;
  return (
    <Link to={`/projects/${p.id}`}>
      <Card className="h-full p-4 transition-colors hover:border-accent/40">
        <div className="flex gap-3">
          <Thumb imageId={p.primaryImageId} className="size-14" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{p.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
              <span className="tabular">{p.code}</span>
              <Badge tone="info">{PROJECT_TYPE_LABEL[p.type]}</Badge>
              <Badge tone={PROJECT_STATUS_META[p.status].tone}>{PROJECT_STATUS_META[p.status].label}</Badge>
              {p.archived && <Badge>Archived</Badge>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-subtle">Cost</div>
            <div className="tabular">{f.money(fin.totalCost, { compact: fin.totalCost >= 10000 })}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">Net sales</div>
            <div className="tabular">{f.money(fin.netProceeds, { compact: fin.netProceeds >= 10000 })}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">Profit</div>
            <MoneyTone value={fin.profit}>
              {f.money(fin.profit, { compact: Math.abs(fin.profit) >= 10000 })}
            </MoneyTone>
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-subtle">
            <span>
              {fin.unitsSold}/{fin.unitsTotal} sold
            </span>
            <span>{fin.totalCost > 0 ? `${f.pct(recovered)} of cost recovered` : 'No cost yet'}</span>
          </div>
          <Progress value={recovered} tone={recovered >= 1 ? 'profit' : 'accent'} />
        </div>
      </Card>
    </Link>
  );
}
