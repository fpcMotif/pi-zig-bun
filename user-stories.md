# pi-zig-bun — User Stories

This is the next-gen evolution of the `pi-zig` project. Unlike the pure-Zig original, this is a **mixed-runtime** AI coding agent: **Zig** powers the high-performance search/indexing (fff.nvim-class), and **Bun** (runtime) orchestrates the agent loop, tools, and extensions.

---

## Personas

### P1 — Solo Terminal Developer
- Wants: fast startup, minimal friction, great defaults.
- **Story**: As P1, I can start `pi` and get instant fuzzy file search via `@` and a responsive streaming chat interface.

### P2 — Workflow Engineer / Power User
- Wants: extension APIs, custom tools, custom commands, automations.
- **Story**: As P2, I can write TypeScript extensions for the agent using the full power of Bun/Node APIs (e.g., calling fetch, reading files, installing npm packages).

### P3 — Team Lead
- Wants: reproducible config, pinned packages, project-scoped settings.
- **Story**: As P3, I can define a `.pi/` directory in our repo with a `package.json` for agent skills that my whole team can use.

### P4 — Tool Integrator
- Wants: RPC mode + SDK, stable schemas, deterministic event streams.
- **Story**: As P4, I can use the Bun SDK to embed the pi-zig-bun agent into our own internal CI tool or custom IDE.

---

## Epic A — Core Mixed Runtime Architecture

### A1 — Zig-Bun JSON-RPC Bridge
**As a developer**, I want a high-speed link between the Bun agent loop and the Zig search/TUI backend.

**Acceptance**
- Bun spawns the Zig binary and communicates via `stdin/stdout` using JSON-RPC 2.0.
- Latency for a search query from Bun → Zig → results → Bun is < 15ms.

### A2 — Bun-Native Agent Loop
**As P1**, I want the agent to use Bun's performance for tool execution and networking.

**Acceptance**
- Agent loop is written in TypeScript/Bun.
- Streaming responses (Anthropic/OpenAI) use Bun's optimized `fetch`.

---

## Epic B — Search & Indexing (fff.nvim-class)

### B1 — Zig-Powered Indexer
**As P1**, I want my 50k+ file repo to be indexed in under 2 seconds.

**Acceptance**
- Zig backend handles file crawling and metadata extraction.
- Respects `.gitignore` and `.ignore` natively.

### B2 — Typo-Resistant Fuzzy Matching
**As P1**, I want file search to work even if I mistype a few characters (e.g., `prduc.js` finding `product.json`).

**Acceptance**
- Matcher implements Levenshtein or similar edit-distance algorithm in Zig.
- Ranking favors exact prefix matches but surfaces fuzzy ones on lower rank.

### B3 — Proximity & Frecency Ranking
**As P1**, I want files I just edited to appear at the top of my search results.

**Acceptance**
- Ranking score = `fuzzy_score + proximity_bonus + frecency_bonus`.
- Frecency is persisted in a local SQLite (via Bun) or binary file (via Zig).

---

## Epic C — Extensions & Tools (Bun-First)

### C1 — TypeScript Skill System
**As P2**, I can add new "skills" by dropping `.ts` files into a `skills/` folder.

**Acceptance**
- Skills are automatically hot-reloaded by Bun.
- Skills have access to the full Node/Bun ecosystem (e.g., `npm:zod`, `npm:axios`).

### C2 — Security Gating
**As P6**, I want to control what tools an extension can use.

**Acceptance**
- Capability-based permissions defined in `settings.json`.
- Extensions must explicitly request `fs`, `network`, or `exec` access.

---
