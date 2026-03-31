export function computeStats(raw: number[]): { p50: number | null, p95: number | null } {
  if (raw.length === 0) return { p50: null, p95: null };
  const sorted = [...raw].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { p50, p95 };
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return "N/A";
  return ms.toFixed(2) + "ms";
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const headerRow = "| " + headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ") + " |";
  const separatorRow = "| " + colWidths.map(w => "-".repeat(w)).join(" | ") + " |";
  const dataRows = rows.map(row => "| " + row.map((c, i) => String(c).padEnd(colWidths[i])).join(" | ") + " |");
  return [headerRow, separatorRow, ...dataRows].join("\n");
}
