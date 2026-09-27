import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { addSale, updateSale } from '@/db/repo';
import type { Item, Sale } from '@/db/schema';
import { useFormat, useSettings } from '@/app/context';
import { useLedger } from '@/app/data';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyField, NumberInput, Select, Textarea } from '@/components/ui/field';
import { KeyValue } from '@/components/ui/card';
import { MoneyTone } from '@/components/ui/badge';
import { ItemPicker } from '@/components/items/ItemPicker';
import { estimateFees, round2 } from '@/lib/money';
import { today } from '@/lib/dates';
import { errorMessage } from '@/lib/utils';

interface Draft {
  itemId: string | null;
  quantity: number;
  price: number | null;
  shippingCharged: number | null;
  shippingCost: number | null;
  fees: number | null;
  autoFees: boolean;
  platform: string;
  date: string;
  buyer: string;
  notes: string;
}

export function SaleDialog({
  open,
  onClose,
  itemId,
  sale,
}: {
  open: boolean;
  onClose: () => void;
  itemId?: string;
  sale?: Sale;
}) {
  const settings = useSettings();
  const f = useFormat();
  const data = useLedger();
  const [d, setD] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (sale) {
      setD({ ...sale, autoFees: false, fees: sale.fees, itemId: sale.itemId });
      return;
    }
    void (async () => {
      const item = itemId ? await db.items.get(itemId) : undefined;
      const platform =
        settings.platforms.find((p) => p.name === item?.listingPlatform)?.id ?? settings.defaultPlatformId;
      setD({
        itemId: itemId ?? null,
        quantity: 1,
        price: item?.listPrice ?? null,
        shippingCharged: null,
        shippingCost: null,
        fees: null,
        autoFees: true,
        platform,
        date: today(),
        buyer: '',
        notes: '',
      });
    })();
  }, [open, sale, itemId, settings.defaultPlatformId, settings.platforms]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => (p ? { ...p, [k]: v } : p));
  const platform = settings.platforms.find((p) => p.id === d?.platform);
  const fees = d
    ? d.autoFees
      ? estimateFees((d.price ?? 0) + (d.shippingCharged ?? 0), platform)
      : (d.fees ?? 0)
    : 0;
  const fin = d?.itemId ? data?.ledger.items.get(d.itemId) : undefined;
  const item = d?.itemId ? data?.ds.items.find((i) => i.id === d.itemId) : undefined;
  const maxQty = fin ? fin.remainingQty + (sale?.quantity ?? 0) : 1;

  const preview = useMemo(() => {
    if (!d || !fin) return null;
    const revenue = (d.price ?? 0) + (d.shippingCharged ?? 0);
    const net = revenue - fees - (d.shippingCost ?? 0);
    const cost = fin.unitCost * d.quantity;
    const profit = net - cost;
    return { revenue, net, cost, profit, margin: revenue > 0 ? profit / revenue : null };
  }, [d, fin, fees]);

  const save = async () => {
    if (!d?.itemId) return toast.error('Choose the item that was sold');
    if (d.price === null) return toast.error('Enter the sale price');
    setSaving(true);
    try {
      const payload = {
        itemId: d.itemId,
        quantity: Math.max(1, Math.min(maxQty || 1, d.quantity)),
        price: round2(d.price),
        shippingCharged: round2(d.shippingCharged ?? 0),
        shippingCost: round2(d.shippingCost ?? 0),
        fees: round2(fees),
        platform: d.platform,
        date: d.date || today(),
        buyer: d.buyer,
        notes: d.notes,
      };
      if (sale) await updateSale(sale.id, payload);
      else await addSale(payload);
      toast.success(sale ? 'Sale updated' : 'Sale recorded');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={sale ? 'Edit sale' : 'Record sale'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {sale ? 'Save' : 'Record sale'}
          </Button>
        </>
      }
    >
      {d && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Item" className="sm:col-span-2">
            {itemId || sale ? (
              <div className="flex h-10 items-center gap-2 rounded-xl bg-surface-2 px-3 text-sm">
                <span className="tabular text-xs text-subtle">{item?.code}</span>
                <span className="truncate">{item?.name}</span>
              </div>
            ) : (
              <ItemPicker
                value={d.itemId}
                onChange={(it: Item | null) => {
                  set('itemId', it?.id ?? null);
                  if (it?.listPrice && d.price === null) set('price', it.listPrice);
                }}
              />
            )}
          </Field>
          <MoneyField
            label="Sale price (goods)"
            value={d.price}
            onChange={(v) => set('price', v)}
            hint={d.quantity > 1 ? 'Total for all units sold' : undefined}
          />
          <Field label={`Quantity${maxQty > 1 ? ` (max ${maxQty})` : ''}`}>
            <NumberInput
              value={d.quantity}
              allowEmpty={false}
              onChange={(v) => set('quantity', Math.max(1, Math.round(v ?? 1)))}
            />
          </Field>
          <Field label="Platform">
            <Select value={d.platform} onChange={(e) => set('platform', e.target.value)}>
              {settings.platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <MoneyField
            label="Shipping paid by buyer"
            value={d.shippingCharged}
            onChange={(v) => set('shippingCharged', v)}
          />
          <MoneyField
            label="Your postage & packaging"
            value={d.shippingCost}
            onChange={(v) => set('shippingCost', v)}
          />
          <MoneyField
            label="Fees"
            value={d.autoFees ? fees : d.fees}
            onChange={(v) => setD((p) => (p ? { ...p, fees: v, autoFees: false } : p))}
            hint={
              d.autoFees ? (
                `Auto: ${platform?.feePercent ?? 0}% + ${f.money(platform?.fixedFee ?? 0)}`
              ) : (
                <button type="button" className="text-accent" onClick={() => set('autoFees', true)}>
                  Use platform fee estimate
                </button>
              )
            }
          />
          <Field label="Buyer (optional)">
            <Input value={d.buyer} onChange={(e) => set('buyer', e.target.value)} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          {preview && (
            <div className="rounded-xl bg-surface-2 px-3 py-2 sm:col-span-2">
              <KeyValue label="Received (incl. shipping)" value={f.money(preview.revenue)} />
              <KeyValue label="After fees & postage" value={f.money(preview.net)} />
              <KeyValue label="Cost of units sold" value={f.money(preview.cost)} />
              <KeyValue
                label="Profit"
                value={
                  <MoneyTone value={preview.profit} className="font-semibold">
                    {f.money(preview.profit, { signed: true })} · {f.pct(preview.margin)}
                  </MoneyTone>
                }
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
