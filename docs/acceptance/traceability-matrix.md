# Acceptance Traceability Matrix

| requirement id | implementation file(s) | test case id(s) | pass criteria (验收标准) |
|---|---|---|---|
| SPEC-ARCH-001 | `src/main.ts`, `src/search/client.ts`, `src/session/tree.ts` | `TC-CLI-001`, `TC-SESSION-001`, `TC-RPC-001`, `MANUAL-SPEC-ARCH-001` | Mixed runtime architecture flow is demonstrable in automated and manual runs. |
| SPEC-BRIDGE-001 | `src/search/bridge.ts`, `src/search/client.ts` | `TC-RPC-001`, `TC-BRIDGE-001`, `MANUAL-SPEC-BRIDGE-001` | JSON-RPC transport and lifecycle behavior are validated. |
| SPEC-SEARCH-001 | `src/search/client.ts`, `src/search/bridge.ts`, `scripts/ci-search-regression.ts` | `TC-RPC-001`, `PERF-SEARCH-001`, `PERF-INIT-001`, `MANUAL-SPEC-SEARCH-001` | Search behavior and threshold checks pass. |
| SPEC-SEC-001 | `src/permissions.ts`, `src/tools/types.ts`, `src/tools/builtin.ts` | `TC-PERM-001`, `TC-PERM-002`, `TC-TOOLS-001`, `MANUAL-SPEC-SEC-001` | Capability checks deny by default and enforce required permissions. |
| SPEC-CLI-001 | `src/cli.ts`, `src/main.ts` | `TC-CLI-001`, `TC-CLI-002`, `TC-CLI-003`, `MANUAL-SPEC-CLI-001` | CLI command parsing and help semantics match specification. |
| PRD-MUST-001 | `src/main.ts`, `src/search/client.ts`, `src/session/tree.ts`, `src/extensions/loader.ts`, `src/tools/builtin.ts` | `TC-SESSION-001`, `TC-RPC-001`, `TC-EXT-001`, `TC-TOOLS-001`, `MANUAL-PRD-MUST-001` | Each must-have area maps to implementation and verifiable evidence. |
| PRD-SHOULD-001 | `src/search/client.ts`, `tests/perf/search-benchmark.ts` | `PERF-SEARCH-001`, `MANUAL-PRD-SHOULD-001` | Should-have scope is tracked with benchmark coverage and manual review. |
| US-A1 | `src/search/bridge.ts`, `src/search/client.ts` | `TC-RPC-001`, `TC-BRIDGE-001`, `MANUAL-US-A1` | Bridge round-trip and reliability are validated. |
| US-A2 | `src/main.ts`, `src/cli.ts`, `src/tools/builtin.ts` | `TC-CLI-001`, `TC-TOOLS-001`, `MANUAL-US-A2` | Bun loop and tool execution behavior are validated. |
| US-B1 | `src/zig/main.zig`, `src/search/client.ts` | `PERF-INIT-001`, `MANUAL-US-B1` | Initialization performance and indexing quality are validated. |
| US-B2 | `src/zig/main.zig`, `src/search/client.ts` | `PERF-SEARCH-001`, `MANUAL-US-B2` | Typo-tolerant behavior and search latency are validated. |
| US-B3 | `src/zig/main.zig`, `src/search/types.ts` | `MANUAL-US-B3` | Ranking dimensions are manually validated. |
| US-C1 | `src/extensions/loader.ts`, `src/extensions/types.ts`, `src/tools/types.ts` | `TC-EXT-001`, `TC-EXT-002`, `MANUAL-US-C1` | Skill loading success/failure behavior is validated. |
| US-C2 | `src/permissions.ts`, `src/tools/types.ts` | `TC-PERM-001`, `TC-PERM-002`, `TC-TOOLS-001`, `MANUAL-US-C2` | Capability gating for extension tools is validated. |
