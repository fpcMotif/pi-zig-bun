// PERF-COLD-001
import { BUN_EXECUTABLE, percentile95 } from "./lib";

const iterations = Number.parseInt(process.env.PERF_COLD_START_ITERATIONS ?? "5", 10);
const thresholdMs = Number.parseFloat(process.env.PERF_COLD_START_P95_MS ?? "300");
const samples: number[] = [];

for (let i = 0; i < iterations; i++) {
  const started = performance.now();
  const proc = Bun.spawn([BUN_EXECUTABLE, "index.ts", "--help"], { stdout: "ignore", stderr: "ignore" });
  const code = await proc.exited;
  const elapsed = performance.now() - started;
  if (code !== 0) {
    throw new Error(`cold-start probe failed with exit code ${code}`);
  }
  samples.push(elapsed);
}

const p95 = percentile95(samples);
console.log(JSON.stringify({ benchmark: "cold-start", iterations, p95Ms: p95, thresholdMs }, null, 2));
if (p95 > thresholdMs) {
  throw new Error(`cold-start benchmark p95 ${p95.toFixed(2)}ms exceeded ${thresholdMs}ms`);
}
