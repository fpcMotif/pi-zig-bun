# Spec & PRD Gap Analysis — pi-zig-bun

> Generated: 2026-03-04
> Sources: `spec.md`, `prd.json`, `user-stories.md`, `product.md`

---

## Summary Scorecard

| Area | Completion | Status |
|------|-----------|--------|
| **M1 - Skeleton** (Build, JSON-RPC, CLI) | ~85% | Core bridge and CLI working |
| **M2 - fff-Search v1** (Indexer, Fuzzy, Grep) | ~70% | Fuzzy + grep working, ranking incomplete |
| **M3 - Agent MVP** (Chat, Streaming, Tools, Sessions) | ~30% | Sessions done, no LLM/streaming/TUI |
| **M4 - Skills & Extensions** (Loader, Capabilities) | ~60% | Loader works, security bypassed |

**Overall: ~55% of V1 requirements are implemented.**

---

## Epic A — Core Mixed Runtime Architecture

### A1: Zig-Bun JSON-RPC Bridge

| Requirement | Status | Details |
|---|---|---|
| Bun spawns Zig binary via stdin/stdout JSON-RPC 2.0 | **DONE** | `src/search/bridge.ts` spawns `pi-zig-search` |
| Round-trip latency <15ms | **PARTIAL** | Bridge restarts Zig process on every `call()` (`bridge.ts:207-210`). Each call pays process spawn cost. Must keep process alive. |
| Health-check ping returns <5ms | **PARTIAL** | Zig has `ping` → `pong` (`main.zig:876`), but bridge restarts process per call so it can't serve as a quick health check |
| Handles stderr/crashes gracefully | **DONE** | stderr logged to `.pi/search-bridge.stderr.log`, close/error events handled |
| `ui.update` / `ui.input` RPC methods | **NOT DONE** | Not implemented in Zig or Bun — no TUI bridge exists |

### A2: Bun-Native Agent Loop

| Requirement | Status | Details |
|---|---|---|
| Agent loop in TypeScript/Bun | **PARTIAL** | Interactive REPL exists (`src/main.ts:59-126`) but it's a command dispatcher, NOT an AI agent loop |
| Streaming responses (Anthropic/OpenAI) via Bun fetch | **NOT DONE** | No LLM provider integration anywhere in the codebase |
| Provider-agnostic (swap key/model) | **NOT DONE** | No provider abstraction layer |
| Session auto-saved to JSONL | **DONE** | Commands in interactive mode fork sessions |
| Branching via fork | **DONE** | `SessionTree.fork()` works correctly |

---

## Epic B — Search & Indexing (fff.nvim-class)

### B1: Zig-Powered Indexer

| Requirement | Status | Details |
|---|---|---|
| `search.init` indexes workspace | **DONE** | `SearchState.build()` in `main.zig` recursively scans |
| <2s for 50k files | **UNTESTED** | No benchmark or perf test exists |
| Respects `.gitignore` | **DONE** | `loadIgnorePatterns()` parses `.gitignore` |
| Respects `.ignore` and `.geminiignore` | **NOT DONE** | Only `.gitignore` is loaded (`main.zig:83`) |
| Incremental re-index (detect added/deleted/modified) | **NOT DONE** | No `fs.watch`, no incremental update — full rebuild on each `search.init` |
| Persistent binary index at `~/.pi/cache/search/` | **NOT DONE** | Index is in-memory only, rebuilt each time |

### B2: Typo-Resistant Fuzzy Matching

| Requirement | Status | Details |
|---|---|---|
| Levenshtein edit-distance algorithm | **DONE** | `levenshteinLimited()` in `main.zig` with early termination |
| 1-2 typos returns correct file in top 5 | **DONE** | Fuzzy matching with configurable `max_typos` |
| Ranking: exact/prefix > substring > fuzzy | **DONE** | Prefix=1000, substring=600-700, fuzzy=250-400 |
| Search latency <10ms p95 for 50k files | **UNTESTED** | No latency benchmarks exist |

### B3: Proximity & Frecency Ranking

| Requirement | Status | Details |
|---|---|---|
| `fuzzy_score` | **DONE** | Core scoring implemented |
| `git_bonus` (+20% for modified/untracked) | **NOT DONE** | No git integration in Zig search |
| `frecency_bonus` (+15% for recently opened) | **NOT DONE** | Only mtime-based `freshness` bonus exists (`main.zig:524-527`), which is NOT frecency (user access patterns) |
| `proximity_bonus` (+10% for files near cwd) | **NOT DONE** | No proximity scoring relative to cwd |
| Combined score formula per spec | **NOT DONE** | Missing 3 of 4 ranking signals |
| Bonus weights configurable | **NOT DONE** | Hardcoded values only |

---

## Epic C — Extensions & Tools (Bun-First)

### C1: TypeScript Skill System

| Requirement | Status | Details |
|---|---|---|
| Drop .ts into skills/ → auto-discovered | **DONE** | `loadSkills()` in `src/extensions/loader.ts` scans `skills/` and `.pi/skills/` |
| Skills call `registerTool()` | **DONE** | `SkillContext.registerTool` works |
| npm packages usable | **DONE** | Dynamic `import()` through Bun supports npm |
| Hot-reload on file change | **NOT DONE** | No file watcher — skills loaded once at startup |
| `registerHook()` for events | **STUB** | Function exists but is a no-op (`loader.ts:33`) |

### C2: Security Gating

| Requirement | Status | Details |
|---|---|---|
| Capability-based deny-by-default | **DONE** | `CapabilityManager` in `src/permissions.ts` |
| Glob-pattern path matching | **DONE** | `patternToRegex()` handles `*`, `**`, `?` |
| Policy loaded from `.pi/policy.json` or `settings.json` | **NOT DONE** | Policy is hardcoded to `allowAll` in `src/main.ts:142-148` |
| Denied operations logged | **NOT DONE** | `require()` throws but no audit logging |
| UI/CLI prompt for unknown capabilities | **NOT DONE** | No interactive permission prompt |

---

## PRD V1 Must-Have Features

| Feature | Status | Gap |
|---|---|---|
| Bun-orchestrated agent loop | **PARTIAL** | REPL exists but no AI agent loop |
| Zig-powered search engine | **DONE** | Working fuzzy search + grep |
| Typo-resistant fuzzy file search | **DONE** | Levenshtein matching works |
| Interactive TUI with streaming | **NOT DONE** | No TUI — no Zig TUI renderer, no `ui.update`/`ui.input` |
| JSONL session tree | **DONE** | Branching sessions with `id`/`parentId` |
| Provider support (OpenAI, Anthropic, Google) | **NOT DONE** | Zero provider code |
| Default tools: read, write, edit, bash | **DONE** | All 4 tools in `src/tools/builtin.ts` |
| Capability-based extension system | **PARTIAL** | Framework exists but always grants all permissions |

## PRD V1 Should-Have Features

| Feature | Status |
|---|---|
| Git-aware ranking | **NOT DONE** |
| Frecency-based ranking | **NOT DONE** |
| Web-view mode via Bun HTTP server | **NOT DONE** |

## PRD Performance Targets

| Target | Status | Notes |
|---|---|---|
| Search p95 <10ms for 50k files | **UNKNOWN** | No benchmarks exist |
| Initial index <2.0s for 50k files | **UNKNOWN** | No benchmarks exist |
| TUI render <16ms (60fps) | **N/A** | No TUI exists |
| Cold start <150ms | **UNKNOWN** | No measurement |

---

## CLI Commands (spec.md §6)

| Command | Status | Notes |
|---|---|---|
| `pi` (interactive TUI) | **PARTIAL** | REPL exists, not TUI |
| `pi -p "query"` (one-shot) | **DONE** | `-p`/`--prompt` now routes to one-shot prompt/query execution |
| `pi --json "query"` | **DONE** | `--json` now supports one-shot prompt/query execution as well as subcommands |
| `pi /login` | **DONE** | Adds provider credential validation + local `.pi/config.json` write flow |
| `pi /tree` | **DONE** | Works |
| `pi search <query>` | **DONE** | Works |

---

## Critical Missing Features (Ranked by Impact)

### 1. LLM Provider Integration (blocks M3 entirely)
- No code for calling OpenAI, Anthropic, or Google APIs
- No streaming response handling
- No provider abstraction/swapping
- **Needed**: `src/providers/` directory with provider interfaces and implementations

### 2. TUI Rendering (blocks M3)
- No Zig TUI module — spec calls for `src/zig/tui/`
- No `ui.update` or `ui.input` JSON-RPC methods
- No terminal rendering, ANSI output, or frame management

### 3. Search Ranking Signals (3 of 4 missing from spec)
- Missing: `git_bonus`, `frecency_bonus`, `proximity_bonus`
- Only have: `fuzzy_score` + mtime-based `freshness` (not frecency)
- **File**: `src/zig/main.zig`

### 4. Bridge Per-Call Restart (performance bug)
- `bridge.ts:207-210`: Every `call()` does `stop()` then `start()`
- This makes the <15ms round-trip target impossible
- **File**: `src/search/bridge.ts` — keep process alive between calls

### 5. Policy Loading & Permission Enforcement
- Hardcoded `allowAll` in `main.ts` — defeats the security model
- No `.pi/policy.json` loading
- **Files**: `src/main.ts`, `src/permissions.ts`

### 6. Incremental Indexing
- Full rebuild on every init, no filesystem watcher
- **File**: `src/zig/main.zig`

### 7. Hot-Reload for Skills
- Skills loaded once at startup, no file watching
- **File**: `src/extensions/loader.ts`

### 8. Ignore File Support
- Only `.gitignore` parsed; spec requires `.ignore` and `.geminiignore` too
- **File**: `src/zig/main.zig` `loadIgnorePatterns()`

---

## What IS Working Well

- JSON-RPC 2.0 protocol implementation (Zig + TypeScript)
- Fuzzy matching with Levenshtein (Zig)
- Grep with line-level results (Zig)
- .gitignore parsing (Zig)
- JSONL session tree with branching (TypeScript)
- Built-in tools: read, write, edit, bash (TypeScript)
- Capability framework architecture (TypeScript)
- TypeScript skill loader (TypeScript)
- CLI argument parsing (TypeScript)
- CI regression test pipeline

---

## JSON-RPC Bridge Methods

| Method | Zig Handler | Bun Caller | Status |
|---|---|---|---|
| `search.files` | Implemented | Implemented | **Working** |
| `search.grep` | Implemented | Implemented | **Working** |
| `search.init` | Implemented | Implemented | **Working** |
| `search.stats` | Implemented | Not called | Zig-only, unused |
| `ping` | Implemented | Not called | Zig-only, unused |
| `ui.update` | Not implemented | Not implemented | **Missing** |
| `ui.input` | Not implemented | Not implemented | **Missing** |

---

## Testing Coverage

| Area | Status |
|---|---|
| Unit tests (`bun test`) | **NOT DONE** — No `.test.ts` files exist |
| Integration tests | **MINIMAL** — Only `scripts/ci-search-regression.ts` (smoke test) |
| Performance benchmarks | **NOT DONE** — No latency/throughput tests |
| Zig tests | **NOT DONE** — No `test` blocks in `main.zig` |
