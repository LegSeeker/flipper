const DAY = 86_400_000;

/** Local calendar date as ISO `yyyy-mm-dd`. */
export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toISODate(new Date());
}

/** Parse `yyyy-mm-dd` as a local date (not UTC, which would shift the day). */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function daysBetween(from: string | number | Date, to: string | number | Date = new Date()): number {
  const a = typeof from === 'string' ? parseISODate(from) : new Date(from);
  const b = typeof to === 'string' ? parseISODate(to) : new Date(to);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / DAY);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** All month keys (`yyyy-mm`) from `from` to `to` inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = parseISODate(from);
  const end = parseISODate(to);
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end && out.length < 600) {
    out.push(toISODate(cur).slice(0, 7));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

export function inRange(iso: string | null | undefined, from: string, to: string): boolean {
  return Boolean(iso) && iso! >= from && iso! <= to;
}

export type PeriodKey = '30d' | '90d' | 'month' | 'last_month' | 'ytd' | '12m' | 'last_year' | 'all';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  month: 'This month',
  last_month: 'Last month',
  ytd: 'Year to date',
  '12m': 'Last 12 months',
  last_year: 'Last year',
  all: 'All time',
};

export function periodRange(key: PeriodKey, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const to = toISODate(now);
  switch (key) {
    case '30d':
      return { from: toISODate(new Date(now.getTime() - 29 * DAY)), to };
    case '90d':
      return { from: toISODate(new Date(now.getTime() - 89 * DAY)), to };
    case 'month':
      return { from: toISODate(new Date(y, m, 1)), to };
    case 'last_month':
      return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) };
    case 'ytd':
      return { from: toISODate(new Date(y, 0, 1)), to };
    case '12m':
      return { from: toISODate(new Date(y, m - 11, 1)), to };
    case 'last_year':
      return { from: toISODate(new Date(y - 1, 0, 1)), to: toISODate(new Date(y - 1, 11, 31)) };
    case 'all':
      return { from: '1970-01-01', to: '9999-12-31' };
  }
}

export function formatDate(iso: string | number | null | undefined, locale: string): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const d = typeof iso === 'string' ? parseISODate(iso) : new Date(iso);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function formatMonth(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(
    parseISODate(`${key}-01`),
  );
}

export function relativeTime(ts: number, locale: string, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
  if (abs < 365 * DAY) return rtf.format(Math.round(diff / (30 * DAY)), 'month');
  return rtf.format(Math.round(diff / (365 * DAY)), 'year');
}
