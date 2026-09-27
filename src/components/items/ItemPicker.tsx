import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { db } from '@/db/db';
import { ACTIVE_ITEM_STATUSES, type Item } from '@/db/schema';
import { inputClass } from '@/components/ui/field';
import { ItemStatusBadge } from '@/components/ui/badge';
import { matches } from '@/components/layout/SearchDialog';
import { cn } from '@/lib/utils';

/** Type-ahead picker for choosing one item. Shows active items by default. */
export function ItemPicker({
  value,
  onChange,
  filter,
  placeholder = 'Search items by name or ID…',
  excludeIds = [],
}: {
  value: string | null;
  onChange: (item: Item | null) => void;
  filter?: (i: Item) => boolean;
  placeholder?: string;
  excludeIds?: string[];
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const items = useLiveQuery(() => db.items.toArray(), []);
  const selected = items?.find((i) => i.id === value);

  const options = useMemo(() => {
    const pool = (items ?? []).filter(
      (i) =>
        !i.archived &&
        !excludeIds.includes(i.id) &&
        (filter ? filter(i) : ACTIVE_ITEM_STATUSES.includes(i.status)),
    );
    return (q ? pool.filter((i) => matches(q, i.code, i.name, i.brand, i.model)) : pool)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
  }, [items, q, filter, excludeIds]);

  if (selected) {
    return (
      <div className={cn(inputClass, 'flex h-10 items-center gap-2')}>
        <span className="tabular text-xs text-subtle">{selected.code}</span>
        <span className="min-w-0 flex-1 truncate">{selected.name}</span>
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange(null)}
          className="text-subtle hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        className={cn(inputClass, 'h-10')}
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl">
          {options.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(i);
                  setQ('');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-2"
              >
                <span className="tabular w-20 shrink-0 text-xs text-subtle">{i.code}</span>
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <ItemStatusBadge status={i.status} />
              </button>
            </li>
          ))}
          {!options.length && (
            <li className="px-3 py-4 text-center text-sm text-subtle">No matching items</li>
          )}
        </ul>
      )}
    </div>
  );
}
