export const BUN_EXECUTABLE = process.execPath;

export function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}


export function computeStats(raw: number[]): { p50: number | null; p95: number | null } {
  if (raw.length === 0) return { p50: null, p95: null };
  const sorted = [...raw].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? null
  };
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return "N/A";
  return ms.toFixed(2) + "ms";
}

export function markdownTable(headers: string[], rows: string[][]): string {
  let result = "| " + headers.join(" | ") + " |\n";
  result += "| " + headers.map(() => "---").join(" | ") + " |\n";
  for (const row of rows) {
    result += "| " + row.join(" | ") + " |\n";
  }
  return result;
}
