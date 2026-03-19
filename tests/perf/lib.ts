export const BUN_EXECUTABLE = process.execPath;

export function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export function percentile50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.50)] ?? 0;
}

export function computeStats(values: number[]): { p50: number; p95: number } {
  return {
    p50: percentile50(values),
    p95: percentile95(values),
  };
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return "N/A";
  return ms.toFixed(2);
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const table = [];
  table.push(`| ${headers.join(" | ")} |`);
  table.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    table.push(`| ${row.join(" | ")} |`);
  }
  return table.join("\n");
}
