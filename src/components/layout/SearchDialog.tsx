import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, FolderKanban, Search } from 'lucide-react';
import { db } from '@/db/db';
import { Modal } from '@/components/ui/dialog';
import { ItemStatusBadge, PROJECT_TYPE_LABEL } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function matches(q: string, ...fields: (string | undefined | null)[]): boolean {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const items = useLiveQuery(() => (open ? db.items.toArray() : []), [open]);
  const projects = useLiveQuery(() => (open ? db.projects.toArray() : []), [open]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const its = (items ?? [])
      .filter((i) =>
        matches(
          q,
          i.code,
          i.name,
          i.brand,
          i.model,
          i.category,
          i.storageLocation,
          i.barcode,
          i.tags.join(' '),
        ),
      )
      .slice(0, 12)
      .map((i) => ({ kind: 'item' as const, id: i.id, code: i.code, name: i.name, item: i }));
    const prs = (projects ?? [])
      .filter((p) => matches(q, p.code, p.name, p.description, p.tags.join(' ')))
      .slice(0, 6)
      .map((p) => ({ kind: 'project' as const, id: p.id, code: p.code, name: p.name, type: p.type }));
    return [...its, ...prs];
  }, [q, items, projects]);

  const go = (r: (typeof results)[number]) => {
    onClose();
    navigate(r.kind === 'item' ? `/items/${r.id}` : `/projects/${r.id}`);
  };

  return (
    <Modal open={open} onClose={onClose} title="Search" size="md">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && results[active]) go(results[active]);
          }}
          placeholder="Name, ID (e.g. FL-00012), brand, location, tag…"
          className="h-11 w-full rounded-xl border border-border bg-surface-2 pr-3 pl-9 text-sm outline-none focus:border-accent"
        />
      </div>
      <ul className="mt-3 space-y-1">
        {results.map((r, i) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => go(r)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left',
                i === active ? 'bg-surface-2' : '',
              )}
            >
              {r.kind === 'item' ? (
                <Boxes className="size-4 text-subtle" />
              ) : (
                <FolderKanban className="size-4 text-subtle" />
              )}
              <span className="tabular w-20 shrink-0 text-xs text-subtle">{r.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{r.name || 'Untitled'}</span>
              {r.kind === 'item' ? (
                <ItemStatusBadge status={r.item.status} />
              ) : (
                <span className="text-xs text-subtle">{PROJECT_TYPE_LABEL[r.type]}</span>
              )}
            </button>
          </li>
        ))}
        {q.trim() && !results.length && <li className="py-6 text-center text-sm text-subtle">No matches</li>}
      </ul>
    </Modal>
  );
}
