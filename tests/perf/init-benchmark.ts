// PERF-INIT-001
import { SearchClient } from "../../src/search/client";
import { percentile95 } from "./lib";

const cwd = process.cwd();
const iterations = Number.parseInt(process.env.PERF_INIT_ITERATIONS ?? "5", 10);
const thresholdMs = Number.parseFloat(process.env.PERF_INIT_P95_MS ?? "250");
const samples: number[] = [];

for (let i = 0; i < iterations; i++) {
  const client = SearchClient.from({ workspaceRoot: cwd, requestTimeoutMs: 30_000 });
  const started = performance.now();
  try {
    await client.init(cwd);
    samples.push(performance.now() - started);
  } finally {
    await client.stop();
  }
}

const p95 = percentile95(samples);
console.log(JSON.stringify({ benchmark: "init", iterations, p95Ms: p95, thresholdMs }, null, 2));
if (p95 > thresholdMs) {
  throw new Error(`init benchmark p95 ${p95.toFixed(2)}ms exceeded ${thresholdMs}ms`);
}
