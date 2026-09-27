import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ListPlus, Sparkles } from 'lucide-react';
import { createItem } from '@/db/repo';
import type { ID } from '@/db/schema';
import { useAiContext, useFormat, useSettings } from '@/app/context';
import { suggestPartOut, type PartOutResult } from '@/ai/tasks';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Textarea } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { AiDisclaimer, AiErrorText, AiNotConfigured, useAiJob } from './common';
import { round2 } from '@/lib/money';
import { parseNumber } from '@/lib/utils';

interface Row {
  name: string;
  category: string;
  quantity: number;
  price: number | null;
  notes: string;
  include: boolean;
  demand?: string;
}

/** Parse "Name, price[, qty]" lines. */
export function parsePartLines(text: string): Row[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      const name = parts[0];
      const price = parts[1] ? parseNumber(parts[1]) : null;
      const qty = parts[2] ? Math.max(1, Math.round(parseNumber(parts[2]) ?? 1)) : 1;
      return { name, category: '', quantity: qty, price, notes: '', include: true };
    });
}

export function PartOutDialog({
  open,
  onClose,
  projectId,
  source,
  parentItemId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: ID;
  source: { name: string; description: string; purchasePrice?: number };
  parentItemId?: ID | null;
}) {
  const ai = useAiContext();
  const settings = useSettings();
  const f = useFormat();
  const [mode, setMode] = useState<'ai' | 'paste'>(ai.configured ? 'ai' : 'paste');
  const [details, setDetails] = useState('');
  const [paste, setPaste] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const job = useAiJob<PartOutResult>();

  useEffect(() => {
    if (open) {
      setDetails(source.description);
      setRows([]);
      setNotes('');
    }
  }, [open, source.description]);

  const generate = async () => {
    const res = await job.run((signal) =>
      suggestPartOut(
        ai,
        { name: source.name, description: details, purchasePrice: source.purchasePrice },
        settings.categories,
        signal,
      ),
    );
    if (res) {
      setRows(
        res.parts.map((p) => ({
          name: p.name,
          category: p.category,
          quantity: Math.max(1, Math.round(p.quantity)),
          price: p.estimatedPrice ?? null,
          notes: [p.notes, p.difficulty ? `Removal: ${p.difficulty}` : ''].filter(Boolean).join(' · '),
          include: true,
          demand: p.demand,
        })),
      );
      setNotes(res.notes);
    }
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include && r.name.trim());
  const total = chosen.reduce((s, r) => s + (r.price ?? 0) * r.quantity, 0);

  const create = async () => {
    setCreating(true);
    try {
      for (const r of chosen) {
        await createItem({
          name: r.name.trim(),
          category: r.category,
          quantity: r.quantity,
          estimatedValue: r.price !== null ? round2(r.price) : null,
          notes: r.notes,
          projectId,
          parentItemId: parentItemId ?? null,
          status: 'in_stock',
          condition: 'good',
          purchaseDate: null,
        });
      }
      toast.success(`Created ${chosen.length} items`);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add parts to break"
      size="xl"
      footer={
        rows.length ? (
          <>
            <span className="mr-auto self-center text-sm text-muted">
              {chosen.length} items · est. {f.money(total)}
            </span>
            <Button onClick={() => setRows([])}>Back</Button>
            <Button variant="primary" onClick={create} loading={creating} disabled={!chosen.length}>
              Create {chosen.length} items
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            {mode === 'ai' ? (
              <Button
                variant="primary"
                onClick={generate}
                loading={job.loading}
                disabled={!ai.configured}
                icon={<Sparkles className="size-4" />}
              >
                Suggest parts
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => setRows(parsePartLines(paste))}
                disabled={!paste.trim()}
                icon={<ListPlus className="size-4" />}
              >
                Preview
              </Button>
            )}
          </>
        )
      }
    >
      {!rows.length ? (
        <div className="space-y-3">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'ai', label: 'AI suggestions' },
              { value: 'paste', label: 'Paste a list' },
            ]}
          />
          {mode === 'ai' ? (
            ai.configured ? (
              <>
                <p className="text-sm text-muted">
                  The AI lists sellable parts for <b className="text-fg">{source.name}</b> with estimated
                  prices. You pick which to create — each becomes an item with its own ID, sharing the project
                  cost.
                </p>
                <Field label="Details (year, spec, engine, condition, what's damaged…)">
                  <Textarea rows={4} value={details} onChange={(e) => setDetails(e.target.value)} />
                </Field>
                <AiErrorText message={job.error} />
                <AiDisclaimer />
              </>
            ) : (
              <AiNotConfigured />
            )
          ) : (
            <Field label="One part per line: name, price, quantity (price & quantity optional)">
              <Textarea
                rows={10}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={'Headlight left, 45\nAlloy wheel 17", 60, 4\nECU'}
              />
            </Field>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {notes && <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{notes}</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr>
                  <th className="w-8 py-2" />
                  <th className="py-2">Part</th>
                  <th className="w-40 py-2">Category</th>
                  <th className="w-20 py-2">Qty</th>
                  <th className="w-28 py-2">Est. price (unit)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={i} className={r.include ? '' : 'opacity-50'}>
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={r.include}
                        onChange={(e) => update(i, { include: e.target.checked })}
                        aria-label="Include"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={r.name}
                        onChange={(e) => update(i, { name: e.target.value })}
                        className="h-9"
                      />
                      {(r.notes || r.demand) && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-subtle">
                          {r.demand && (
                            <Badge
                              tone={r.demand === 'high' ? 'profit' : r.demand === 'low' ? 'neutral' : 'info'}
                            >
                              {r.demand} demand
                            </Badge>
                          )}
                          <span className="truncate">{r.notes}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <Input
                        list="partout-cats"
                        value={r.category}
                        onChange={(e) => update(i, { category: e.target.value })}
                        className="h-9"
                      />
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <NumberInput
                        value={r.quantity}
                        allowEmpty={false}
                        onChange={(v) => update(i, { quantity: Math.max(1, Math.round(v ?? 1)) })}
                        className="[&_input]:h-9"
                      />
                    </td>
                    <td className="py-1.5 align-top">
                      <NumberInput
                        value={r.price}
                        onChange={(v) => update(i, { price: v })}
                        className="[&_input]:h-9"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="partout-cats">
              {settings.categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
      )}
    </Modal>
  );
}
