#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { SearchBridge } from "../src/search/bridge";

const FILE_COUNT = Number.parseInt(process.env.SEARCH_BENCH_FILE_COUNT ?? "50000", 10);
const WARM_CALLS = Number.parseInt(process.env.SEARCH_BENCH_WARM_CALLS ?? "5", 10);
const MEASURED_CALLS = Number.parseInt(process.env.SEARCH_BENCH_MEASURED_CALLS ?? "40", 10);
const P95_THRESHOLD_MS = Number.parseInt(process.env.SEARCH_BENCH_P95_MS ?? "60", 10);
const INIT_THRESHOLD_MS = Number.parseInt(process.env.SEARCH_BENCH_INIT_MS ?? "7000", 10);

if (![FILE_COUNT, WARM_CALLS, MEASURED_CALLS, P95_THRESHOLD_MS, INIT_THRESHOLD_MS].every((v) => Number.isFinite(v) && v > 0)) {
  throw new Error("benchmark inputs must be positive numbers");
}

const workspace = await mkdtemp(path.join(tmpdir(), "pi-bench-"));
const binaryPath = path.join(process.cwd(), "zig-out", "bin", process.platform === "win32" ? "pi-zig-search.exe" : "pi-zig-search");
if (!existsSync(binaryPath)) {
  throw new Error("Zig binary missing; run `zig build` before running benchmarks");
}

const bridge = new SearchBridge({ workspaceRoot: workspace, binaryPath, requestTimeoutMs: 120_000 });

const fail = (message: string): never => {
  throw new Error(`search benchmark failed: ${message}`);
};

try {
  await mkdir(path.join(workspace, "pkg"), { recursive: true });

  for (let i = 0; i < FILE_COUNT; i++) {
    const group = String(Math.floor(i / 1000));
    const dir = path.join(workspace, "pkg", group);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `file-${i}.ts`), `export const symbol${i} = "needle-${i % 17}";\n`, "utf8");
  }

  const init = await bridge.call<{ elapsed_ms: number; file_count: number }>("search.init", { root: workspace });
  if (init.file_count < FILE_COUNT) {
    fail(`expected at least ${FILE_COUNT} indexed files, got ${init.file_count}`);
  }

  for (let i = 0; i < WARM_CALLS; i++) {
    await bridge.call("search.files", { query: "needle", cwd: workspace, limit: 20, includeScores: true });
  }

  const samples: number[] = [];
  for (let i = 0; i < MEASURED_CALLS; i++) {
    const result = await bridge.call<{ elapsedMs: number }>("search.files", {
      query: "needle",
      cwd: workspace,
      limit: 20,
      includeScores: true,
    });
    samples.push(result.elapsedMs);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  const p95 = sorted[p95Index] ?? Number.POSITIVE_INFINITY;

  console.log(JSON.stringify({
    fileCount: FILE_COUNT,
    initMs: init.elapsed_ms,
    p95Ms: p95,
    thresholds: { initMs: INIT_THRESHOLD_MS, p95Ms: P95_THRESHOLD_MS },
  }, null, 2));

  if (init.elapsed_ms > INIT_THRESHOLD_MS) {
    fail(`initial indexing ${init.elapsed_ms}ms exceeded threshold ${INIT_THRESHOLD_MS}ms`);
  }

  if (p95 > P95_THRESHOLD_MS) {
    fail(`warmed search p95 ${p95}ms exceeded threshold ${P95_THRESHOLD_MS}ms`);
  }
} finally {
  await bridge.stop();
  await rm(workspace, { recursive: true, force: true });
}
