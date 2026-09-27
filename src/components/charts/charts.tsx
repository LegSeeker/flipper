/**
 * Chart building blocks. Follows the house rules: one y-axis, thin bars
 * (<=24px) with 4px rounded data-ends, hairline solid grid, legend for 2+
 * series, text in ink tokens (never series colour), tooltip on hover and a
 * table view elsewhere on the page so values are never hover-only.
 */
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { useFormat } from '@/app/context';
import { formatMonth } from '@/lib/dates';
import { cn } from '@/lib/utils';

export interface SeriesDef<K extends string> {
  key: K;
  label: string;
  color: string;
}

export function Legend({ series }: { series: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
}: TooltipContentProps<number, string> & { series: SeriesDef<string>[] }) {
  const f = useFormat();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-fg">{formatMonth(String(label), f.locale)}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        return (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular text-fg">{f.money(Number(p?.value ?? 0))}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Grouped monthly columns in one currency (same unit, so one axis). */
export function MonthlyColumns<T extends { month: string }, K extends Extract<keyof T, string>>({
  data,
  series,
  height = 240,
}: {
  data: T[];
  series: SeriesDef<K>[];
  height?: number;
}) {
  const f = useFormat();
  return (
    <div className="space-y-2">
      {series.length > 1 && <Legend series={series} />}
      <div style={{ height }} className="-ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            barGap={2}
            barCategoryGap="24%"
            margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => formatMonth(m, f.locale)}
              tick={{ fill: 'var(--subtle)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              tickFormatter={(v: number) => f.money(v, { compact: true })}
              tick={{ fill: 'var(--subtle)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={(props) => (
                <ChartTooltip {...(props as TooltipContentProps<number, string>)} series={series} />
              )}
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Horizontal bar list in plain HTML: label, bar, value at the tip. Doubles as
 * its own table view because every value is printed.
 */
export function BarList({
  rows,
  format,
  emptyText = 'No data for this period',
}: {
  rows: { label: ReactNode; value: number; sub?: ReactNode }[];
  format: (n: number) => string;
  emptyText?: string;
}) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-subtle">{emptyText}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => {
        const pct = (Math.abs(r.value) / max) * 100;
        return (
          <li
            key={i}
            className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_auto]"
          >
            <div className="min-w-0">
              <div className="truncate">{r.label}</div>
              {r.sub && <div className="truncate text-xs text-subtle">{r.sub}</div>}
            </div>
            <div className="h-2.5 rounded-full bg-surface-2">
              <div
                className={cn('h-full rounded-full', r.value < 0 ? 'bg-loss' : 'bg-series-1')}
                style={{ width: `${Math.max(pct, r.value !== 0 ? 2 : 0)}%` }}
              />
            </div>
            <div className="tabular text-right text-sm">{format(r.value)}</div>
          </li>
        );
      })}
    </ul>
  );
}
