type Cell = string | number | boolean | null | undefined;

function escapeCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start of text).
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const r of rows) lines.push(r.map(escapeCell).join(','));
  // BOM so Excel detects UTF-8.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function csvBlob(headers: string[], rows: Cell[][]): Blob {
  return new Blob([toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
}
