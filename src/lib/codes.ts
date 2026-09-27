/** Human-readable sequential code, e.g. formatCode('FL', 42, 5) -> "FL-00042". */
export function formatCode(prefix: string, n: number, padding: number): string {
  const p = prefix.trim();
  const num = String(n).padStart(padding, '0');
  return p ? `${p}-${num}` : num;
}
