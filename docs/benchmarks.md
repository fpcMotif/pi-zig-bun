# Benchmarking

This project includes reproducible benchmark scripts for PRD performance targets.

## What is measured

`bun benchmarks/run.ts` builds the Zig search binary in `ReleaseFast`, generates (or reuses) a synthetic 50k-file workspace, and prints a metric table with p50/p95:

- `search_latency_p95_50k_files`: warmed `search.files` latency (same long-lived Zig process after `search.init`).
- `initial_index_time_50k_files`: `search.init` elapsed time for a fresh search process.
- `cold_start_time`: CLI process startup time (`bun src/main.ts --help`).
- `tui_render_latency`: placeholder row until TUI frame benchmark exists.

## Hardware/runtime assumptions

Threshold enforcement in CI is calibrated for GitHub-hosted `ubuntu-latest` runners with:

- Bun (`oven-sh/setup-bun@v2`, latest)
- Zig `0.15.2`
- Linux x64 shared vCPU environment

Local runs will vary based on CPU class, storage, thermal throttling, and background load.

## Commands

```bash
# generate fixture only
bun benchmarks/generate-fixture.ts

# run benchmark suite and print p50/p95 table
bun benchmarks/run.ts

# CI threshold gate with rerun policy
bun scripts/ci-bench-thresholds.ts
```

## CI non-flaky policy

Threshold config is defined in `benchmarks/thresholds.json`.

- Each metric has a PRD target and tolerance percentage.
- CI runs benchmark attempts multiple times (`rerunAttempts`), then uses the **best** attempt for comparison.
- CI fails only when all rerun attempts exceed `target * (1 + tolerancePct/100)`.

This lowers false positives from transient runner noise while still catching sustained regressions.
