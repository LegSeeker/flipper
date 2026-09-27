import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { db } from '@/db/db';
import { addRequirements, emptyRequirement } from '@/db/repo';
import { ACTIVE_ITEM_STATUSES, type ID, type Item, type OwnerType } from '@/db/schema';
import { useAiContext, useFormat } from '@/app/context';
import { planRepair, type RepairResult } from '@/ai/tasks';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { AiDisclaimer, AiErrorText, AiNotConfigured, useAiJob } from './common';
import { round2 } from '@/lib/money';

/** Very small fuzzy match: every word of the shorter name appears in the longer one. */
export function findInventoryMatch(partName: string, stock: Item[]): Item | undefined {
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
  const pw = words(partName);
  if (!pw.length) return undefined;
  return stock.find((it) => {
    const iw = words(`${it.name} ${it.model}`);
    const [short, long] = pw.length <= iw.length ? [pw, iw] : [iw, pw];
    return short.length > 0 && short.every((w) => long.includes(w));
  });
}

export function RepairPlanner({
  open,
  onClose,
  ownerType,
  ownerId,
  subject,
}: {
  open: boolean;
  onClose: () => void;
  ownerType: OwnerType;
  ownerId: ID;
  subject: string;
}) {
  const ai = useAiContext();
  const f = useFormat();
  const [fault, setFault] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [stock, setStock] = useState<Item[]>([]);
  const job = useAiJob<RepairResult>();

  useEffect(() => {
    if (!open) return;
    void db.items
      .toArray()
      .then((all) =>
        setStock(
          all.filter(
            (i) =>
              !i.archived &&
              i.id !== ownerId &&
              ACTIVE_ITEM_STATUSES.includes(i.status) &&
              i.status !== 'sourcing',
          ),
        ),
      );
  }, [open, ownerId]);

  const generate = async () => {
    const res = await job.run((signal) =>
      planRepair(
        ai,
        subject,
        fault,
        stock.map((s) => s.name),
        signal,
      ),
    );
    if (res) setPicked(new Set(res.parts.map((p, i) => (p.required ? i : -1)).filter((i) => i >= 0)));
  };

  const addSelected = async () => {
    const res = job.result;
    if (!res) return;
    const list = res.parts
      .filter((_, i) => picked.has(i))
      .map((p) => {
        const match = findInventoryMatch(p.name, stock);
        return {
          ...emptyRequirement(ownerType, ownerId),
          name: p.name,
          quantity: Math.max(1, Math.round(p.quantity)),
          estimatedCost:
            p.estimatedCost !== null && p.estimatedCost !== undefined ? round2(p.estimatedCost) : null,
          notes: p.notes,
          status: match ? ('in_stock' as const) : ('needed' as const),
          inventoryItemId: match?.id ?? null,
          priority: p.required ? ('normal' as const) : ('low' as const),
        };
      });
    await addRequirements(list);
    toast.success(`Added ${list.length} parts to the list`);
    onClose();
  };

  const res = job.result;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI repair plan"
      size="lg"
      footer={
        res ? (
          <>
            <Button onClick={() => job.setResult(null)}>Back</Button>
            <Button variant="primary" onClick={addSelected} disabled={!picked.size}>
              Add {picked.size} parts to list
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button
              variant="primary"
              onClick={generate}
              loading={job.loading}
              disabled={!ai.configured}
              icon={<Sparkles className="size-4" />}
            >
              Build plan
            </Button>
          </>
        )
      }
    >
      {!ai.configured ? (
        <AiNotConfigured />
      ) : !res ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Describe the fault (or what you want to achieve). The AI builds a shopping list and checks your
            stock for parts you already have.
          </p>
          <Field label="Fault / goal">
            <Textarea
              rows={4}
              value={fault}
              onChange={(e) => setFault(e.target.value)}
              placeholder="e.g. No power, smells burnt near the PSU. Cracked screen corner."
              autoFocus
            />
          </Field>
          <AiErrorText message={job.error} />
          <AiDisclaimer />
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {res.diagnosis && <p>{res.diagnosis}</p>}
          <div className="flex flex-wrap gap-2">
            <Badge
              tone={res.difficulty === 'high' ? 'loss' : res.difficulty === 'medium' ? 'warn' : 'profit'}
            >
              Difficulty: {res.difficulty}
            </Badge>
            {res.estimatedHours ? <Badge>~{res.estimatedHours} h</Badge> : null}
            <Badge tone="warn">
              Parts est.{' '}
              {f.money(
                res.parts.filter((_, i) => picked.has(i)).reduce((s, p) => s + (p.estimatedCost ?? 0), 0),
              )}
            </Badge>
          </div>
          <div>
            <h3 className="mb-2 font-medium">Parts</h3>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {res.parts.map((p, i) => {
                const match = findInventoryMatch(p.name, stock);
                return (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-[var(--accent)]"
                        checked={picked.has(i)}
                        onChange={() =>
                          setPicked((s) => {
                            const n = new Set(s);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block">
                          {p.quantity > 1 && `${p.quantity}× `}
                          {p.name} {!p.required && <span className="text-xs text-subtle">(optional)</span>}
                        </span>
                        {p.notes && <span className="block text-xs text-subtle">{p.notes}</span>}
                        {match && (
                          <span className="block text-xs text-profit">
                            In your stock: {match.code} {match.name}
                          </span>
                        )}
                      </span>
                      <span className="tabular text-muted">
                        {p.estimatedCost ? f.money(p.estimatedCost) : ''}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          {res.steps.length > 0 && (
            <div>
              <h3 className="mb-1 font-medium">Steps</h3>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                {res.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          {res.tools.length > 0 && (
            <p className="text-muted">
              <span className="font-medium text-fg">Tools:</span> {res.tools.join(', ')}
            </p>
          )}
          {res.risks.length > 0 && (
            <p className="text-warn">
              <span className="font-medium">Risks:</span> {res.risks.join(' · ')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
