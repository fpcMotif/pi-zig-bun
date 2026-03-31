// PERF-SEARCH-001
import { SearchClient } from "../../src/search/client";
import { percentile95 } from "./lib";

const cwd = process.cwd();
const iterations = Number.parseInt(process.env.PERF_SEARCH_ITERATIONS ?? "10", 10);
const p95ThresholdMs = Number.parseFloat(process.env.PERF_SEARCH_P95_MS ?? "25");

const samples: number[] = [];
const client = SearchClient.from({ workspaceRoot: cwd, requestTimeoutMs: 30_000 });

try {
  await client.ensureInitialized(cwd);
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    await client.searchFiles("src", { cwd, limit: 20 });
    samples.push(performance.now() - started);
  }
} finally {
  await client.stop();
}

const p95 = percentile95(samples);
console.log(JSON.stringify({ benchmark: "search", iterations, p95Ms: p95, thresholdMs: p95ThresholdMs }, null, 2));
if (p95 > p95ThresholdMs) {
  throw new Error(`search benchmark p95 ${p95.toFixed(2)}ms exceeded ${p95ThresholdMs}ms`);
}
