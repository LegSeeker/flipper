/** Round to cents, avoiding binary float artefacts like 0.1 + 0.2. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${compact}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : undefined,
      });
    } catch {
      f = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    }
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(
  n: number | null | undefined,
  opts: { locale: string; currency: string; compact?: boolean; signed?: boolean },
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const f = formatter(opts.locale, opts.currency, Boolean(opts.compact));
  const text = f.format(Math.abs(n) < 0.005 ? 0 : n);
  if (opts.signed && n > 0.004) return `+${text}`;
  return text;
}

export function currencySymbol(locale: string, currency: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export function formatPercent(n: number | null | undefined, locale: string, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits }).format(n);
}

export function formatNumber(n: number | null | undefined, locale: string, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
}

/** Estimated platform fees for a sale total. */
export function estimateFees(
  total: number,
  fee: { feePercent: number; fixedFee: number } | undefined,
): number {
  if (!fee || total <= 0) return 0;
  return round2((total * fee.feePercent) / 100 + fee.fixedFee);
}
