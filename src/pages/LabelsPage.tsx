import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import QRCode from 'qrcode';
import { Printer } from 'lucide-react';
import { db } from '@/db/db';
import type { Item } from '@/db/schema';
import { useFormat } from '@/app/context';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';

/** Deep link that opens the item when the QR code is scanned with any phone camera. */
export function itemUrl(id: string): string {
  return `${location.origin}${location.pathname}#/items/${id}`;
}

export default function LabelsPage() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const items = useLiveQuery(
    async () => (await db.items.bulkGet(ids)).filter(Boolean) as Item[],
    [params.get('ids')],
  );
  const [layout, setLayout] = useState<'sheet' | 'roll'>('sheet');
  const [showPrice, setShowPrice] = useState(false);
  const [showLocation, setShowLocation] = useState(true);

  return (
    <>
      <PageHeader
        title="Print labels"
        subtitle={`${items?.length ?? 0} labels`}
        back
        actions={
          <Button
            variant="primary"
            icon={<Printer className="size-4" />}
            onClick={() => window.print()}
            disabled={!items?.length}
          >
            Print
          </Button>
        }
      />
      <Page>
        <Card className="no-print flex flex-wrap items-center gap-4 p-3">
          <Segmented
            size="sm"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'sheet', label: 'A4 / Letter sheet' },
              { value: 'roll', label: 'Label printer (62×29 mm)' },
            ]}
          />
          <Checkbox checked={showPrice} onChange={setShowPrice} label="Price" />
          <Checkbox checked={showLocation} onChange={setShowLocation} label="Location" />
          <p className="w-full text-xs text-subtle">
            Scanning a label's QR code with a phone camera opens the item in Flipper (on devices where your
            data is synced).
          </p>
        </Card>
        <style>
          {layout === 'roll' ? '@page { size: 62mm 29mm; margin: 0; }' : '@page { margin: 10mm; }'}
        </style>
        <div
          className={cn(
            layout === 'sheet'
              ? 'grid grid-cols-2 gap-2 sm:grid-cols-3 print:grid-cols-3 print:gap-[2mm]'
              : 'flex flex-col items-start gap-2 print:gap-0',
          )}
        >
          {(items ?? []).map((i) => (
            <Label
              key={i.id}
              item={i}
              roll={layout === 'roll'}
              showPrice={showPrice}
              showLocation={showLocation}
            />
          ))}
        </div>
      </Page>
    </>
  );
}

function Label({
  item,
  roll,
  showPrice,
  showLocation,
}: {
  item: Item;
  roll: boolean;
  showPrice: boolean;
  showLocation: boolean;
}) {
  const f = useFormat();
  const [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(itemUrl(item.id), { margin: 0, width: 240, errorCorrectionLevel: 'M' }).then(setQr);
  }, [item.id]);
  return (
    <div
      className={cn(
        'flex items-center gap-[2.5mm] overflow-hidden border border-dashed border-neutral-300 bg-white p-[2mm] text-black print:border-neutral-200',
        roll ? 'h-[29mm] w-[62mm] print:break-after-page' : 'h-[30mm] break-inside-avoid',
      )}
    >
      {qr && <img src={qr} alt="" className="h-[24mm] w-[24mm] shrink-0" />}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[14pt] font-bold tracking-tight">{item.code}</div>
        <div className="line-clamp-2 text-[8pt]">{item.name}</div>
        {showLocation && item.storageLocation && (
          <div className="text-[7pt] text-neutral-600">📍 {item.storageLocation}</div>
        )}
        {showPrice && item.listPrice !== null && (
          <div className="text-[10pt] font-semibold">{f.money(item.listPrice)}</div>
        )}
      </div>
    </div>
  );
}
