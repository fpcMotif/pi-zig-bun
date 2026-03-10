// PERF-COLD-001

const iterations = Number.parseInt(process.env.PERF_COLD_START_ITERATIONS ?? "5", 10);
const thresholdMs = Number.parseFloat(process.env.PERF_COLD_START_P95_MS ?? "300");
const samples: number[] = [];

for (let i = 0; i < iterations; i++) {
  const started = performance.now();
  const proc = Bun.spawn(["bun", "run", "index.ts", "--help"], { stdout: "ignore", stderr: "ignore" });
  const code = await proc.exited;
  const elapsed = performance.now() - started;
  if (code !== 0) {
    throw new Error(`cold-start probe failed with exit code ${code}`);
  }
  samples.push(elapsed);
}

samples.sort((a, b) => a - b);
const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? samples[samples.length - 1] ?? 0;
console.log(JSON.stringify({ benchmark: "cold-start", iterations, p95Ms: p95, thresholdMs }, null, 2));
if (p95 > thresholdMs) {
  throw new Error(`cold-start benchmark p95 ${p95.toFixed(2)}ms exceeded ${thresholdMs}ms`);
}
