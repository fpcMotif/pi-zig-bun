#!/usr/bin/env bun
import path from "node:path";
import { SearchClient } from "../src/search/client";

const root = path.join(process.cwd(), "tests", "fixtures", "search-workspace");
const p95TargetMs = Number(process.env.PERF_SEARCH_P95_MS ?? "120");
const indexTargetMs = Number(process.env.PERF_INDEX_MS ?? "250");
const coldStartTargetMs = Number(process.env.PERF_COLD_START_MS ?? "350");
const iterations = Number(process.env.PERF_ITERATIONS ?? "12");

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

const client = SearchClient.from({ workspaceRoot: root });
const artifact: Record<string, number | string> = {};

try {
  const coldStartBegin = performance.now();
  await client.ensureInitialized(root);
  const coldStartMs = performance.now() - coldStartBegin;
  artifact.cold_start_ms = coldStartMs;

  const indexBegin = performance.now();
  await client.init(root);
  const indexMs = performance.now() - indexBegin;
  artifact.index_time_ms = indexMs;

  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const res = await client.searchFiles("search", { cwd: root, limit: 5, includeScores: true });
    samples.push(res.elapsedMs);
  }

  const p95Ms = percentile95(samples);
  artifact.search_latency_p95_ms = p95Ms;
  artifact.samples = samples.join(",");

  const failures: string[] = [];
  if (p95Ms > p95TargetMs) failures.push(`search latency p95 ${p95Ms}ms > ${p95TargetMs}ms`);
  if (indexMs > indexTargetMs) failures.push(`index time ${indexMs.toFixed(1)}ms > ${indexTargetMs}ms`);
  if (coldStartMs > coldStartTargetMs) failures.push(`cold start ${coldStartMs.toFixed(1)}ms > ${coldStartTargetMs}ms`);

  const logPath = path.join(process.cwd(), ".pi", "perf-gates.log");
  await Bun.write(logPath, `${JSON.stringify(artifact, null, 2)}\n`);

  if (failures.length > 0) {
    throw new Error(`perf gates failed: ${failures.join("; ")}`);
  }

  console.log(`perf gates passed: p95=${p95Ms}ms index=${indexMs.toFixed(1)}ms cold=${coldStartMs.toFixed(1)}ms`);
} finally {
  await client.stop();
}
