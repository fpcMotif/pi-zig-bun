export function computeStats(raw: number[]): { p50: number | null; p95: number | null } {
  if (raw.length === 0) return { p50: null, p95: null };
  const sorted = [...raw].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.50)] ?? null,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? null
  };
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return "N/A";
  return ms.toFixed(2);
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const table = [];
  table.push("| " + headers.join(" | ") + " |");
  table.push("| " + headers.map(() => "---").join(" | ") + " |");
  for (const row of rows) {
    table.push("| " + row.join(" | ") + " |");
  }
  return table.join("\n");
}
