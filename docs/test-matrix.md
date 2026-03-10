# Requirement-Mapped Test Matrix

| Requirement | Coverage | Type | Pass/Fail Threshold |
| --- | --- | --- | --- |
| Bun tests for `src/cli.ts` | `test/cli.test.ts` validates command parsing, flag handling, defaults, and usage text. | Unit | `bun test test/cli.test.ts` must pass. |
| Bun tests for `src/permissions.ts` | `test/permissions.test.ts` validates wildcard/path matching, `session.access`, policy updates, and error behavior. | Unit | `bun test test/permissions.test.ts` must pass. |
| Bun tests for `src/extensions/loader.ts` | `test/extensions-loader.test.ts` validates valid-skill loading, failure accounting, and noop fallback. | Unit | `bun test test/extensions-loader.test.ts` must pass. |
| Bun tests for `src/session/tree.ts` | `test/session-tree.test.ts` validates root creation, branching, history, malformed line handling, and missing parent errors. | Unit | `bun test test/session-tree.test.ts` must pass. |
| Search client/bridge behavior | `test/search-bridge-client.test.ts` validates `SearchClient` RPC parameter mapping plus `SearchBridge` persistence, concurrency, and error propagation. | Unit | `bun test test/search-bridge-client.test.ts` must pass. |
| Zig fuzzy matching | `src/zig/main.zig` test `levenshteinLimited supports fuzzy matching boundaries`. | Zig unit | `zig test src/zig/main.zig` must pass. |
| Zig ignore parsing fixture | Fixture: `test/fixtures/zig/ignore-sample.gitignore`; parser behavior covered by `shouldIgnorePath respects loaded ignore patterns`. | Zig unit + fixture | `zig test src/zig/main.zig` must pass. |
| Zig ranking | `src/zig/main.zig` test `fileHitLessThan ranks by score then recency`. | Zig unit | `zig test src/zig/main.zig` must pass. |
| Zig RPC handlers | `src/zig/main.zig` test `handleRequest responds for ping and unknown methods`. | Zig unit | `zig test src/zig/main.zig` must pass. |
| Bun↔Zig JSON-RPC end-to-end (persistent process, errors, concurrency) | `test/json-rpc.integration.test.ts` validates `search.init`, `search.files`, `search.grep`, unknown method errors, and concurrent requests against the real Zig binary. | Integration | `bun test test/json-rpc.integration.test.ts` must pass (after `zig build`). |
| Search performance benchmarks | `scripts/bench-search.ts` generates a 50k-file warmed index, checks `search.init` and warmed `search.files` p95 latency thresholds. | Benchmark | Fail if `initMs > SEARCH_BENCH_INIT_MS` (default 7000) or `p95Ms > SEARCH_BENCH_P95_MS` (default 60). |

## CI command map

- `bun run test`: Bun unit + integration tests.
- `bun run test:zig`: Zig unit tests.
- `bun run bench:search`: Benchmark threshold gate.
- `bun run ci`: Type-check, Zig tests/build, Bun tests, regression checks, benchmark gate.
