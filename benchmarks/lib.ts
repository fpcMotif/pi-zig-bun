export interface Stats {
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
}

export function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) {
    throw new Error("Cannot compute percentile of empty list");
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    throw new Error("Cannot compute stats with no samples");
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((acc, n) => acc + n, 0) / sorted.length;

  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean,
  };
}

export function fmtMs(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)}ms`;
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}
