import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { emptyProject } from '@/db/defaults';
import { createProject, updateProject } from '@/db/repo';
import {
  ALLOCATION_METHODS,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type AllocationMethod,
  type ProjectStatus,
  type ProjectType,
} from '@/db/schema';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/card';
import { Field, Input, MoneyField, Select, TagInput, Textarea, TextField } from '@/components/ui/field';
import { ALLOCATION_HELP, PROJECT_STATUS_META, PROJECT_TYPE_LABEL } from '@/components/ui/badge';
import { today } from '@/lib/dates';
import { cn, errorMessage } from '@/lib/utils';

type Draft = ReturnType<typeof emptyProject>;

const TYPE_HELP: Record<ProjectType, string> = {
  flip: 'Buy, clean up and resell one or more items.',
  part_out: 'Break something (car, laptop, bike…) into parts and sell them individually.',
  repair: 'Fix an item for resale. Track parts you have and need to buy.',
  restoration: 'Longer build or refurbishment with many parts and costs.',
  bundle: 'A bulk lot or job lot split into separate items.',
  other: 'Anything else.',
};

export default function ProjectEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [d, setD] = useState<Draft | null>(null);
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!id) {
        setD({ ...emptyProject(), purchaseDate: today() });
        return;
      }
      const p = await db.projects.get(id);
      if (!p) {
        navigate('/projects');
        return;
      }
      const { id: _i, code: c, createdAt: _c, updatedAt: _u, ...rest } = p;
      setCode(c);
      setD(rest);
    })();
  }, [id, navigate]);

  if (!d) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!d.name.trim()) return toast.error('Name the project');
    setSaving(true);
    try {
      if (isNew) {
        const p = await createProject({ ...d, name: d.name.trim() });
        toast.success(`Created ${p.code}`);
        navigate(`/projects/${p.id}`, { replace: true });
      } else {
        await updateProject(id!, { ...d, name: d.name.trim() });
        toast.success('Saved');
        navigate(`/projects/${id}`, { replace: true });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={isNew ? 'New project' : `Edit ${code}`}
        back
        actions={
          <Button variant="primary" onClick={save} loading={saving}>
            Save
          </Button>
        }
      />
      <Page className="max-w-3xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Section title="Type">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PROJECT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('type', t)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    d.type === t
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-surface-2 hover:border-accent/40',
                  )}
                >
                  <div className="text-sm font-medium">{PROJECT_TYPE_LABEL[t]}</div>
                  <div className="mt-0.5 text-xs text-subtle">{TYPE_HELP[t]}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Basics">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                label="Name *"
                value={d.name}
                onChange={(v) => set('name', v)}
                className="sm:col-span-2"
                autoFocus={isNew}
                placeholder={
                  d.type === 'part_out'
                    ? 'e.g. 2011 BMW 320d E90 breaking'
                    : d.type === 'repair'
                      ? 'e.g. iPhone 12 screen + battery'
                      : 'Project name'
                }
              />
              <Field label="Status">
                <Select value={d.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_META[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Deadline">
                <Input
                  type="date"
                  value={d.deadline ?? ''}
                  onChange={(e) => set('deadline', e.target.value || null)}
                />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={d.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Spec, condition, plan — the AI uses this for part-out and repair suggestions"
                />
              </Field>
              <Field label="Tags" className="sm:col-span-2">
                <TagInput value={d.tags} onChange={(v) => set('tags', v)} />
              </Field>
            </div>
          </Section>

          <Section
            title="Cost"
            description="What you paid for the thing being worked on. It's shared across the project's items."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyField
                label="Purchase price"
                value={d.purchasePrice}
                allowEmpty={false}
                onChange={(v) => set('purchasePrice', v ?? 0)}
              />
              <MoneyField
                label="Extra acquisition costs"
                value={d.purchaseCosts}
                allowEmpty={false}
                onChange={(v) => set('purchaseCosts', v ?? 0)}
                hint="Transport, recovery, fees"
              />
              <Field label="Purchase date">
                <Input
                  type="date"
                  value={d.purchaseDate ?? ''}
                  onChange={(e) => set('purchaseDate', e.target.value || null)}
                />
              </Field>
              <TextField
                label="Bought from"
                value={d.purchaseSource}
                onChange={(v) => set('purchaseSource', v)}
              />
              <MoneyField label="Budget (optional)" value={d.budget} onChange={(v) => set('budget', v)} />
              <MoneyField
                label="Target profit (optional)"
                value={d.targetProfit}
                onChange={(v) => set('targetProfit', v)}
              />
              <Field
                label="Share costs across items"
                className="sm:col-span-2"
                hint={ALLOCATION_HELP[d.allocation]}
              >
                <Select
                  value={d.allocation}
                  onChange={(e) => set('allocation', e.target.value as AllocationMethod)}
                >
                  {ALLOCATION_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m === 'value' ? 'By value' : m === 'equal' ? 'Equally' : 'Manually'}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Section>

          <Section title="Notes">
            <Textarea rows={4} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          </Section>

          <div className="flex justify-end gap-2 pb-6">
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>
              {isNew ? 'Create project' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Page>
    </>
  );
}
