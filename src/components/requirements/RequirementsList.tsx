import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { ExternalLink, Package, Plus, Trash2, Wrench } from 'lucide-react';
import { db } from '@/db/db';
import { addRequirement, deleteRequirement, emptyRequirement, updateRequirement } from '@/db/repo';
import {
  REQUIREMENT_STATUSES,
  type ID,
  type OwnerType,
  type Requirement,
  type RequirementStatus,
} from '@/db/schema';
import { useFormat, useLedger } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { Modal, useConfirm } from '@/components/ui/dialog';
import { Field, Input, MoneyField, NumberInput, Select, Textarea } from '@/components/ui/field';
import { Badge, REQUIREMENT_STATUS_META } from '@/components/ui/badge';
import { ItemPicker } from '@/components/items/ItemPicker';
import { RepairPlanner } from '@/components/ai/RepairPlanner';
import { pendingPartsCost, partsCost } from '@/lib/calc';
import { round2 } from '@/lib/money';
import { cn } from '@/lib/utils';

const NEXT: Record<RequirementStatus, RequirementStatus> = {
  needed: 'ordered',
  ordered: 'in_stock',
  in_stock: 'installed',
  installed: 'needed',
};

export function RequirementsList({
  ownerType,
  ownerId,
  subject,
}: {
  ownerType: OwnerType;
  ownerId: ID;
  subject: string;
}) {
  const reqs = useLiveQuery(
    () => db.requirements.where('[ownerType+ownerId]').equals([ownerType, ownerId]).sortBy('createdAt'),
    [ownerType, ownerId],
  );
  const f = useFormat();
  const [editing, setEditing] = useState<Requirement | 'new' | null>(null);
  const [planner, setPlanner] = useState(false);
  const [quickName, setQuickName] = useState('');

  if (!reqs) return null;
  const pending = pendingPartsCost(reqs);
  const spent = partsCost(reqs);
  const done = reqs.filter((r) => r.status === 'installed').length;

  const quickAdd = async () => {
    if (!quickName.trim()) return;
    await addRequirement({ ...emptyRequirement(ownerType, ownerId), name: quickName.trim() });
    setQuickName('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone="warn">To buy: {f.money(pending)}</Badge>
        <Badge tone="neutral">Spent: {f.money(spent)}</Badge>
        {reqs.length > 0 && (
          <Badge tone="profit">
            {done}/{reqs.length} installed
          </Badge>
        )}
        <div className="flex-1" />
        <Button size="sm" onClick={() => setPlanner(true)} icon={<Wrench className="size-4" />}>
          AI repair plan
        </Button>
      </div>

      {reqs.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {reqs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <button
                type="button"
                title="Click to advance status"
                onClick={() => updateRequirement(r.id, { status: NEXT[r.status] })}
                className="shrink-0"
              >
                <Badge tone={REQUIREMENT_STATUS_META[r.status].tone}>
                  {REQUIREMENT_STATUS_META[r.status].label}
                </Badge>
              </button>
              <button type="button" onClick={() => setEditing(r)} className="min-w-0 flex-1 text-left">
                <div
                  className={cn('truncate text-sm', r.status === 'installed' && 'text-muted line-through')}
                >
                  {r.quantity > 1 && <span className="text-subtle">{r.quantity}× </span>}
                  {r.name}
                </div>
                <div className="flex gap-2 text-xs text-subtle">
                  {r.inventoryItemId && (
                    <span className="inline-flex items-center gap-1">
                      <Package className="size-3" /> from stock
                    </span>
                  )}
                  {r.supplier && <span>{r.supplier}</span>}
                  {r.priority === 'high' && <span className="text-warn">high priority</span>}
                </div>
              </button>
              <div className="tabular text-right text-sm">
                {r.actualCost !== null ? (
                  f.money(r.actualCost)
                ) : r.estimatedCost !== null ? (
                  <span className="text-subtle">~{f.money(r.estimatedCost)}</span>
                ) : (
                  ''
                )}
              </div>
              {r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-subtle hover:text-accent"
                  aria-label="Open link"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          value={quickName}
          onChange={(e) => setQuickName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void quickAdd();
            }
          }}
          placeholder="Add a part or task needed…"
        />
        <Button onClick={quickAdd} icon={<Plus className="size-4" />} aria-label="Add part">
          <span className="hidden sm:inline">Add</span>
        </Button>
        <Button onClick={() => setEditing('new')} className="hidden sm:inline-flex">
          Details…
        </Button>
      </div>

      <RequirementDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        requirement={editing === 'new' ? null : editing}
        ownerType={ownerType}
        ownerId={ownerId}
      />
      <RepairPlanner
        open={planner}
        onClose={() => setPlanner(false)}
        ownerType={ownerType}
        ownerId={ownerId}
        subject={subject}
      />
    </div>
  );
}

function RequirementDialog({
  open,
  onClose,
  requirement,
  ownerType,
  ownerId,
}: {
  open: boolean;
  onClose: () => void;
  requirement: Requirement | null;
  ownerType: OwnerType;
  ownerId: ID;
}) {
  const [d, setD] = useState<Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>>(
    emptyRequirement(ownerType, ownerId),
  );
  const confirm = useConfirm();
  const data = useLedger();

  useEffect(() => {
    if (open) setD(requirement ?? emptyRequirement(ownerType, ownerId));
  }, [open, requirement, ownerType, ownerId]);

  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!d.name.trim()) return toast.error('Name the part');
    if (requirement) await updateRequirement(requirement.id, d);
    else await addRequirement(d);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={requirement ? 'Edit part' : 'Add part'}
      footer={
        <>
          {requirement && (
            <Button
              variant="danger"
              className="mr-auto"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: 'Remove this part?', danger: true, confirmLabel: 'Remove' })) {
                  await deleteRequirement(requirement.id);
                  onClose();
                }
              }}
            >
              Remove
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Part / task" className="sm:col-span-2">
          <Input value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={(e) => set('status', e.target.value as RequirementStatus)}>
            {REQUIREMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REQUIREMENT_STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity">
          <NumberInput
            value={d.quantity}
            allowEmpty={false}
            onChange={(v) => set('quantity', Math.max(1, Math.round(v ?? 1)))}
          />
        </Field>
        <MoneyField
          label="Estimated cost (total)"
          value={d.estimatedCost}
          onChange={(v) => set('estimatedCost', v)}
        />
        <MoneyField
          label="Actual cost (total)"
          value={d.actualCost}
          onChange={(v) => set('actualCost', v)}
          hint="Counts towards cost basis"
        />
        <Field
          label="Use a part from your inventory"
          className="sm:col-span-2"
          hint="The stock item is marked “Used as part” once installed."
        >
          <ItemPicker
            value={d.inventoryItemId}
            excludeIds={ownerType === 'item' ? [ownerId] : []}
            onChange={(it) => {
              const unit = it ? data?.ledger.items.get(it.id)?.unitCost : undefined;
              setD((p) => ({
                ...p,
                inventoryItemId: it?.id ?? null,
                name: p.name || it?.name || '',
                status: it && p.status === 'needed' ? 'in_stock' : p.status,
                actualCost:
                  it && p.actualCost === null && unit !== undefined
                    ? round2(unit * p.quantity)
                    : p.actualCost,
              }));
            }}
          />
          {d.inventoryItemId && (
            <Link to={`/items/${d.inventoryItemId}`} className="text-xs text-accent">
              Open stock item
            </Link>
          )}
        </Field>
        <Field label="Supplier">
          <Input value={d.supplier} onChange={(e) => set('supplier', e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select
            value={d.priority}
            onChange={(e) => set('priority', e.target.value as Requirement['priority'])}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </Select>
        </Field>
        <Field label="Link" className="sm:col-span-2">
          <Input
            type="url"
            value={d.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
