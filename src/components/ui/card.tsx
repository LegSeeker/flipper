import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({
  className,
  children,
  as: Tag = 'div',
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section';
}) {
  return <Tag className={cn('rounded-2xl border border-border bg-surface', className)}>{children}</Tag>;
}

export function Section({
  title,
  action,
  children,
  className,
  bodyClassName,
  description,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  description?: ReactNode;
}) {
  return (
    <Card as="section" className={className}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </header>
      <div className={cn('px-4 pb-4', bodyClassName)}>{children}</div>
    </Card>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'profit' | 'loss' | 'warn' | 'accent';
  icon?: ReactNode;
  className?: string;
}) {
  const toneClass =
    tone === 'profit'
      ? 'text-profit'
      : tone === 'loss'
        ? 'text-loss'
        : tone === 'warn'
          ? 'text-warn'
          : tone === 'accent'
            ? 'text-accent'
            : 'text-fg';
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
        <span className="truncate">{label}</span>
        {icon && <span className="text-subtle">{icon}</span>}
      </div>
      <div className={cn('tabular mt-1.5 truncate text-xl font-semibold tracking-tight', toneClass)}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-subtle">{sub}</div>}
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        <div className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</div>
      )}
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-subtle">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Progress({
  value,
  tone = 'accent',
  className,
}: {
  value: number;
  tone?: 'accent' | 'profit' | 'loss' | 'warn';
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = { accent: 'bg-accent', profit: 'bg-profit', loss: 'bg-loss', warn: 'bg-warn' }[tone];
  return (
    <div
      className={cn('h-2 overflow-hidden rounded-full bg-surface-3', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KeyValue({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5 text-sm', className)}>
      <span className="text-muted">{label}</span>
      <span className="tabular min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

/** Small label + value pair for compact summary strips. */
export function MiniFigure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-subtle">{label}</div>
      <div className="tabular truncate text-sm font-semibold">{value}</div>
    </div>
  );
}
