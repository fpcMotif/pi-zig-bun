export function computeStats(raw: number[]): { p50: number; p95: number } {
  if (raw.length === 0) return { p50: 0, p95: 0 };
  const sorted = [...raw].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  return { p50, p95 };
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return "N/A";
  return ms.toFixed(2) + "ms";
}

export function markdownTable(headers: string[], rows: string[][]): string {
  let table = "| " + headers.join(' | ') + " |\n| " + headers.map(() => '---').join(' | ') + " |\n";
  for (const row of rows) {
    table += "| " + row.join(' | ') + " |\n";
  }
  return table;
}
