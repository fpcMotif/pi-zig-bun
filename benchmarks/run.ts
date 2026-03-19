#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeStats, fmtMs, markdownTable } from "../tests/perf/lib";

interface MetricSummary {
  metric: string;
  samples: number;
  unit: "ms";
  p50: number | null;
  p95: number | null;
  raw: number[];
  skippedReason?: string;
}

interface BenchSummary {
  generatedAt: string;
  fixtureDir: string;
  metrics: MetricSummary[];
}

interface PendingCall {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const BUN_EXECUTABLE = process.execPath;
const ZIG_EXECUTABLE = process.env.ZIG_EXECUTABLE ?? "zig";

class SearchProcess {
  private proc = spawn(path.join(process.cwd(), "zig-out", "bin", process.platform === "win32" ? "pi-zig-search.exe" : "pi-zig-search"), {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: process.cwd(),
  });

  private nextId = 1;
  private buffer = "";
  private pending = new Map<number, PendingCall>();

  constructor() {
    this.proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      while (true) {
        const idx = this.buffer.indexOf("\n");
        if (idx === -1) break;
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const payload = JSON.parse(line) as { id: number; result?: unknown; error?: { message: string; code: number } };
          const pending = this.pending.get(payload.id);
          if (!pending) continue;
          this.pending.delete(payload.id);
          clearTimeout(pending.timeoutHandle);
          if (payload.error) {
            pending.reject(new Error(`${payload.error.code}: ${payload.error.message}`));
          } else {
            pending.resolve(payload.result);
          }
        } catch {
          // ignore non-jsonrpc output
        }
      }
    });

    this.proc.on("exit", (code) => {
      if (code !== 0) {
        const err = new Error(`search process exited with code ${code}`);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeoutHandle);
          pending.reject(err);
        }
        this.pending.clear();
      }
    });
  }

  async call<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    this.proc.stdin.write(`${payload}\n`);

    return await new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }
      }, 60_000);
      timeoutHandle.unref?.();
      this.pending.set(id, { resolve, reject, timeoutHandle });
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutHandle);
    }
    this.pending.clear();
    this.proc.stdin.end();
    this.proc.kill();
  }
}

function ensureReleaseSearchBinary(): void {
  if (process.env.BENCH_SKIP_BUILD === "1") {
    return;
  }

  const run = spawnSync(ZIG_EXECUTABLE, ["build", "-Doptimize=ReleaseFast"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  if (run.status !== 0) {
    throw new Error("failed to build ReleaseFast search binary");
  }
}

async function ensureFixture(dir: string): Promise<void> {
  mkdirSync(path.dirname(dir), { recursive: true });
  const run = spawnSync(BUN_EXECUTABLE, ["benchmarks/generate-fixture.ts", dir], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  if (run.status !== 0) {
    throw new Error("failed to generate fixture workspace");
  }
}

async function benchmarkSearchLatency(fixtureDir: string, samples: number): Promise<MetricSummary> {
  const proc = new SearchProcess();
  try {
    await proc.call("search.init", { root: fixtureDir });
    await proc.call("search.files", { query: "token", limit: 20, cwd: fixtureDir, includeScores: true });
    const raw: number[] = [];
    for (let i = 0; i < samples; i++) {
      const response = await proc.call<{ elapsed_ms: number }>("search.files", {
        query: `token${i % 997}`,
        limit: 20,
        cwd: fixtureDir,
        includeScores: true,
      });
      raw.push(response.elapsed_ms);
    }
    const stats = computeStats(raw);
    return { metric: "search_latency_p95_50k_files", samples, unit: "ms", p50: stats.p50, p95: stats.p95, raw };
  } finally {
    proc.close();
  }
}

async function benchmarkInitialIndex(fixtureDir: string, samples: number): Promise<MetricSummary> {
  const raw: number[] = [];
  for (let i = 0; i < samples; i++) {
    const proc = new SearchProcess();
    try {
      const init = await proc.call<{ elapsed_ms: number }>("search.init", { root: fixtureDir });
      raw.push(init.elapsed_ms);
    } finally {
      proc.close();
    }
  }
  const stats = computeStats(raw);
  return { metric: "initial_index_time_50k_files", samples, unit: "ms", p50: stats.p50, p95: stats.p95, raw };
}

function benchmarkCliColdStart(samples: number): MetricSummary {
  const raw: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    const run = spawnSync(BUN_EXECUTABLE, ["src/main.ts", "--help"], {
      cwd: process.cwd(),
      stdio: "ignore",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const end = performance.now();
    if (run.status !== 0) {
      throw new Error(`CLI cold start sample failed with status ${run.status}`);
    }
    raw.push(end - start);
  }
  const stats = computeStats(raw);
  return { metric: "cold_start_time", samples, unit: "ms", p50: stats.p50, p95: stats.p95, raw };
}

function tuiPlaceholder(): MetricSummary {
  return {
    metric: "tui_render_latency",
    samples: 0,
    unit: "ms",
    p50: null,
    p95: null,
    raw: [],
    skippedReason: "TUI benchmark pending implementation",
  };
}

async function main(): Promise<void> {
  const fixtureDir = process.env.BENCH_FIXTURE_DIR ?? path.join(process.cwd(), ".bench", "workspace-50k");
  const searchSamples = Number.parseInt(process.env.BENCH_SEARCH_SAMPLES ?? "25", 10);
  const indexSamples = Number.parseInt(process.env.BENCH_INDEX_SAMPLES ?? "7", 10);
  const cliSamples = Number.parseInt(process.env.BENCH_CLI_SAMPLES ?? "25", 10);
  const jsonOut = process.env.BENCH_JSON_OUT;

  ensureReleaseSearchBinary();
  await ensureFixture(fixtureDir);

  const metrics: MetricSummary[] = [];
  metrics.push(await benchmarkSearchLatency(fixtureDir, searchSamples));
  metrics.push(await benchmarkInitialIndex(fixtureDir, indexSamples));
  metrics.push(benchmarkCliColdStart(cliSamples));
  metrics.push(tuiPlaceholder());

  const summary: BenchSummary = {
    generatedAt: new Date().toISOString(),
    fixtureDir,
    metrics,
  };

  const rows = metrics.map((metric) => [
    metric.metric,
    metric.samples.toString(),
    fmtMs(metric.p50),
    fmtMs(metric.p95),
    metric.skippedReason ?? "measured",
  ]);

  console.log(markdownTable(["metric", "samples", "p50", "p95", "notes"], rows));

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
  }
}

await main();
