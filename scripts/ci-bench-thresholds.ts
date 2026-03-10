#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

interface Metric {
  metric: string;
  p50: number | null;
  p95: number | null;
}

interface Summary {
  metrics: Metric[];
}

interface Threshold {
  targetMs: number;
  tolerancePct: number;
  rerunAttempts: number;
  value: "p50" | "p95";
}

const thresholds = JSON.parse(readFileSync("benchmarks/thresholds.json", "utf8")) as Record<string, Threshold>;
const attempts = Math.max(...Object.values(thresholds).map((t) => t.rerunAttempts));

function runBenchAttempt(attempt: number): Summary {
  const outDir = mkdtempSync(join(tmpdir(), "pi-zig-bun-bench-"));
  const outFile = join(outDir, `summary-${attempt}.json`);

  const env = {
    ...process.env,
    BENCH_JSON_OUT: outFile,
    BENCH_SEARCH_SAMPLES: process.env.BENCH_SEARCH_SAMPLES ?? "20",
    BENCH_INDEX_SAMPLES: process.env.BENCH_INDEX_SAMPLES ?? "5",
    BENCH_CLI_SAMPLES: process.env.BENCH_CLI_SAMPLES ?? "20",
  };

  const run = spawnSync("bun", ["benchmarks/run.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });

  if (run.status !== 0) {
    throw new Error(`benchmark command failed during attempt ${attempt}`);
  }

  const summary = JSON.parse(readFileSync(outFile, "utf8")) as Summary;
  rmSync(outDir, { recursive: true, force: true });
  return summary;
}

function metricValue(summary: Summary, metric: string, mode: "p50" | "p95"): number {
  const row = summary.metrics.find((item) => item.metric === metric);
  if (!row || row[mode] === null) {
    throw new Error(`missing benchmark metric ${metric}`);
  }
  return row[mode];
}

const summaries: Summary[] = [];
for (let attempt = 1; attempt <= attempts; attempt++) {
  console.log(`benchmark attempt ${attempt}/${attempts}`);
  summaries.push(runBenchAttempt(attempt));
}

const failures: string[] = [];
for (const [metric, threshold] of Object.entries(thresholds)) {
  const allowed = threshold.targetMs * (1 + threshold.tolerancePct / 100);
  const values = summaries.slice(0, threshold.rerunAttempts).map((summary) => metricValue(summary, metric, threshold.value));
  const best = Math.min(...values);

  if (best > allowed) {
    failures.push(
      `${metric} regressed: best ${threshold.value}=${best.toFixed(2)}ms > allowed ${allowed.toFixed(2)}ms (target=${threshold.targetMs}ms, tolerance=${threshold.tolerancePct}%, attempts=${threshold.rerunAttempts})`,
    );
  } else {
    console.log(
      `benchmark threshold passed: ${metric} best ${threshold.value}=${best.toFixed(2)}ms (allowed ${allowed.toFixed(2)}ms)`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(`benchmark regressions detected:\n${failures.join("\n")}`);
}
