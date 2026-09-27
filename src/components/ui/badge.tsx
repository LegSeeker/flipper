import type { ReactNode } from 'react';
import type {
  AllocationMethod,
  ItemStatus,
  ProjectStatus,
  ProjectType,
  RequirementStatus,
} from '@/db/schema';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'accent' | 'profit' | 'loss' | 'warn' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted',
  accent: 'bg-accent/15 text-accent',
  profit: 'bg-profit/15 text-profit',
  loss: 'bg-loss/15 text-loss',
  warn: 'bg-warn/15 text-warn',
  info: 'bg-info/15 text-info',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const ITEM_STATUS_META: Record<ItemStatus, { label: string; tone: Tone }> = {
  sourcing: { label: 'To buy', tone: 'neutral' },
  in_stock: { label: 'In stock', tone: 'info' },
  in_repair: { label: 'In repair', tone: 'warn' },
  listed: { label: 'Listed', tone: 'accent' },
  sold: { label: 'Sold', tone: 'profit' },
  parted_out: { label: 'Parted out', tone: 'neutral' },
  kept: { label: 'Kept', tone: 'neutral' },
  consumed: { label: 'Used as part', tone: 'neutral' },
  written_off: { label: 'Written off', tone: 'loss' },
};

export function ItemStatusBadge({ status, archived }: { status: ItemStatus; archived?: boolean }) {
  const m = ITEM_STATUS_META[status];
  return (
    <span className="inline-flex gap-1">
      <Badge tone={m.tone}>{m.label}</Badge>
      {archived && <Badge>Archived</Badge>}
    </span>
  );
}

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: Tone }> = {
  planning: { label: 'Planning', tone: 'neutral' },
  active: { label: 'Active', tone: 'accent' },
  finished: { label: 'Finished', tone: 'profit' },
};

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  flip: 'Flip',
  part_out: 'Part-out',
  repair: 'Repair',
  restoration: 'Restoration',
  bundle: 'Bundle / lot',
  other: 'Other',
};

export const ALLOCATION_HELP: Record<AllocationMethod, string> = {
  value: 'By estimated value — pricier parts carry more of the cost (recommended).',
  equal: 'Equally per unit.',
  manual: 'Enter each item’s share yourself.',
};

export const REQUIREMENT_STATUS_META: Record<RequirementStatus, { label: string; tone: Tone }> = {
  needed: { label: 'Need to buy', tone: 'warn' },
  ordered: { label: 'Ordered', tone: 'info' },
  in_stock: { label: 'Have it', tone: 'accent' },
  installed: { label: 'Installed', tone: 'profit' },
};

export function MoneyTone({
  value,
  children,
  className,
}: {
  value: number | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const tone =
    value === null || value === undefined || Math.abs(value) < 0.005
      ? ''
      : value > 0
        ? 'text-profit'
        : 'text-loss';
  return <span className={cn('tabular', tone, className)}>{children}</span>;
}
