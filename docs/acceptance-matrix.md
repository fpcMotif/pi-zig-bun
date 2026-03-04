# Requirements Traceability & Acceptance Matrix

This matrix maps `spec.md` and `prd.json` requirements to automated tests and explicit pass criteria (验收标准).

## Legend

- **Status**: `Implemented` / `Partial` / `Missing`
- **Priority**: `Must` indicates PRD v1 must-have scope.
- **Test IDs** reference files under `tests/`.

## Matrix

| Req ID | Source | Priority | Requirement | Status | Owning Test IDs | 验收标准 (Pass Criteria) |
|---|---|---|---|---|---|---|
| PRD-M1 | prd.json `scope.v1_must_have[0]` | Must | Bun-orchestrated agent loop (TypeScript) | Partial | T-E2E-001 | `tests/e2e-smoke.test.ts` verifies `run()` command routing returns success for smoke flow. |
| PRD-M2 | prd.json `scope.v1_must_have[1]` | Must | Zig-powered search engine indexing/search bridge | Implemented | T-E2E-001, T-SC-001 | Smoke test gets deterministic `search` output through JSON-RPC bridge contract and `SearchClient` emits expected RPC payloads. |
| PRD-M3 | prd.json `scope.v1_must_have[2]` | Must | Typo-resistant fuzzy file search and grep | Implemented | T-E2E-001, T-SC-001 | Search and grep command flows return structured results with expected fields (`results` / `matches`) and non-error exit status. |
| PRD-M4 | prd.json `scope.v1_must_have[3]` | Must | Interactive TUI with streaming/tool execution | Missing | T-E2E-001 | Smoke regression around CLI command loop remains green while TUI implementation is pending. |
| PRD-M5 | prd.json `scope.v1_must_have[4]` | Must | JSONL session tree branching history | Implemented | T-SESSION-001, T-SESSION-002 | Branch heads and history chain contain expected turn ordering and unknown parent IDs are rejected. |
| PRD-M6 | prd.json `scope.v1_must_have[5]` | Must | OpenAI/Anthropic/Google provider support | Missing | T-E2E-001 | Existing CLI smoke behavior remains stable while provider adapters are not implemented yet. |
| PRD-M7 | prd.json `scope.v1_must_have[6]` | Must | Default tools: read/write/edit/bash | Partial | T-LOADER-001 | Tool registration pipeline is validated via extension loading and isolated skill failures. |
| PRD-M8 | prd.json `scope.v1_must_have[7]` | Must | Capability-based extension system | Partial | T-PERM-001, T-PERM-002, T-LOADER-001 | Capability manager denies by default, supports glob matching, and extension failures do not stop other skills. |
| SPEC-C1 | spec.md §6 | Should | CLI command/flag parsing and edge cases | Implemented | T-CLI-001, T-CLI-002, T-CLI-003, T-CLI-004 | Command inference, help handling, default fallback, and missing-value errors behave as documented. |
| SPEC-S1 | spec.md §3, §4 | Should | Search RPC contract and client options | Implemented | T-SC-001 | `SearchClient` emits canonical methods (`search.init`, `search.files`, `search.grep`) and parameter defaults. |
| SPEC-E1 | spec.md §5 | Should | Extensions discovery/registration/failure isolation | Implemented | T-LOADER-001, T-LOADER-002 | Valid skills register tools, invalid skill modules are skipped, and broken skills increment failure counts only. |
| SPEC-P1 | spec.md §5 | Should | Permission glob matching and deny-by-default | Implemented | T-PERM-001, T-PERM-002, T-PERM-003 | Policy requires explicit capability grants, handles `*`/`**`/`?`, and normalizes path separators. |
| SPEC-SS1 | spec.md §2.2 | Should | Session branching/history correctness | Implemented | T-SESSION-001, T-SESSION-002 | Tree heads and history reconstruction produce deterministic lineage from root to leaf. |
| SPEC-E2E1 | spec.md §6 | Should | End-to-end smoke for search+grep+tree commands | Implemented | T-E2E-001 | A fake Zig binary receives JSON-RPC calls and all three commands exit `0` with expected output snippets. |

## Test Inventory

| Test ID | File | Description |
|---|---|---|
| T-CLI-001 | `tests/cli.test.ts` | Command + flag parsing for known commands. |
| T-CLI-002 | `tests/cli.test.ts` | Interactive/help defaults and command normalization behavior. |
| T-CLI-003 | `tests/cli.test.ts` | Numeric limit edge-case fallback behavior. |
| T-CLI-004 | `tests/cli.test.ts` | Missing required option values throw explicit errors. |
| T-SESSION-001 | `tests/session-tree.test.ts` | Branch/head/history correctness for multiple branches. |
| T-SESSION-002 | `tests/session-tree.test.ts` | Unknown parent branch guardrail. |
| T-PERM-001 | `tests/permissions.test.ts` | Deny-by-default and explicit target semantics. |
| T-PERM-002 | `tests/permissions.test.ts` | Glob matching and separator normalization. |
| T-PERM-003 | `tests/permissions.test.ts` | Policy update + `require()` denial behavior. |
| T-LOADER-001 | `tests/extensions-loader.test.ts` | Discovery + registration + failure isolation. |
| T-LOADER-002 | `tests/extensions-loader.test.ts` | Placeholder tool registration when no skill tools are loaded. |
| T-SC-001 | `tests/search-client.contract.test.ts` | Search client contract with mocked bridge responses. |
| T-E2E-001 | `tests/e2e-smoke.test.ts` | End-to-end smoke test for `search`, `grep`, and `tree`. |
