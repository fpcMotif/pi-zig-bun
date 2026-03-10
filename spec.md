# pi-zig-bun Architecture Spec

This specification defines a **mixed-runtime** AI coding agent that integrates **Zig** (for performance-critical search and TUI) and **Bun** (for agent logic, tools, and extensions).

References:
- pi_agent_rust: https://github.com/Dicklesworthstone/pi_agent_rust
- pi-mono: https://github.com/badlogic/pi-mono
- fff.nvim: https://github.com/dmtrKovalenko/fff.nvim

---

## 1. High-Level Architecture

```text
.
├── src/
│   ├── zig/             <-- Search engine, Indexer, TUI (Native Zig)
│   │   ├── main.zig
│   │   ├── search/      <-- fff.nvim-class fuzzy matcher
│   │   ├── indexer/     <-- Multi-threaded crawler
│   │   └── tui/         <-- High-speed terminal UI
│   ├── bun/             <-- Agent loop, Tools, Extensions (TypeScript/Bun)
│   │   ├── main.ts
│   │   ├── agent/       <-- Provider orchestration (OpenAI, Anthropic)
│   │   ├── session/     <-- JSONL tree manager
│   │   └── tools/       <-- Tool execution (read, write, bash)
├── tests/
├── build.zig            <-- Zig build script
└── package.json         <-- Bun project configuration
```

---

## 2. Component Breakdown

### 2.1 Zig Performance Backend
- **Search Engine**: A dedicated binary that handles file indexing and fuzzy matching.
  - **Index storage**: Persistent binary index at `~/.pi/cache/search/<hash>/index.bin`.
  - **Typo-resistant Fuzzy Matching**: Implements a customized Levenshtein/edit-distance algorithm for file path ranking.
  - **Ranking Signals**:
    - `fuzzy_score`: Proximity-based character matching.
    - `git_bonus`: +20% score for modified or untracked files.
    - `frecency_bonus`: +15% score for recently opened files (via local frecency DB).
    - `proximity_bonus`: +10% score for files in the current working directory.
- **TUI Core**: Zig-native terminal rendering for maximum frame rates during streaming and search.

### 2.2 Bun Agent Frontend
- **Agent Orchestrator**: Manages the chat loop, prompt construction, and provider calls.
  - **Streaming**: Native Bun `fetch` for Anthropic/OpenAI SSE streams.
  - **Context Window**: Automatic truncation and summary injection.
- **Session Manager**: Manages `JSONL` files with `id`/`parentId` branching logic.
- **Tool Executor**: Runs JavaScript/TypeScript tools natively; spawns `bash` or `read`/`write` operations through Bun's optimized APIs.

---

## 3. Communication Bridge (JSON-RPC 2.0)

Bun and Zig communicate over a high-speed `stdin`/`stdout` bridge using JSON-RPC 2.0.

- **`search.files(query, limit, options)`**: Bun requests ranked file paths from Zig.
- **`search.grep(query, regex, options)`**: Bun requests code snippets from Zig.
- **`ui.update(data)`**: Bun pushes new state to Zig's TUI renderer.
- **`ui.input(event)`**: Zig pushes user keystrokes to Bun's agent loop.

---

## 4. Search Implementation (fff-grade)

The search subsystem must achieve **<10ms latency for a warmed index of 50k files**.

- **Indexer**: Scans on startup, then uses `fs.watch` (or platform equivalent in Zig) for incremental updates.
- **Fuzzy Matcher**: Supports "typo-resistant" queries. For example, `index.ts` matches `idx.ts` or `indexts`.
- **Ignore Rules**: Natively parses `.gitignore`, `.ignore`, and `.geminiignore`.

---

## 5. Security & Extensions

Extensions are **TypeScript skills** loaded by Bun.

- **Capability Gating**:
  - `allow_fs_read`: Regex-based path constraints.
  - `allow_fs_write`: Explicit path permissions.
  - `allow_exec`: Commands must be in a pre-approved list or require manual confirmation.
  - `allow_net`: Only allowed to pre-specified domains.

---

## 6. CLI Command Surface (`pi`)

- `pi` — Interactive mode.
- `pi -p "query"` — One-shot print mode (equivalent to `pi search "query"`).
- `pi --json "query"` — One-shot JSON search response.
- `pi /login` or `pi login` — Auth setup and persisted config update.
- `pi /tree` or `pi tree` — View session branching history.
- `pi search <query>` — Explicit CLI search command.
- Backward-compatible aliases such as `session` and `tree` remain available.
