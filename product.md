# pi-zig-bun — Product Overview

pi-zig-bun is the high-performance AI coding agent of the future. It's built for developers who want the speed of native tools and the flexibility of the TypeScript ecosystem.

---

## 1. Key Value Propositions

- **Native Speed**: Zig powers the search engine and terminal rendering, ensuring your UI never lags, even in huge monorepos.
- **TypeScript Extensibility**: Write your own coding "skills" in TS using the Bun runtime. No complex C/C++ ABI knowledge required.
- **fff.nvim-grade Search**: Find what you need instantly with typo-resistant fuzzy search, ranking files by proximity, git status, and frecency.
- **Advanced Branching History**: Every session is a branching tree (stored as JSONL). Branch from any previous turn to explore different solutions without losing context.
- **Security First**: Capability-based permissions for all agent tools. Deny-by-default execution keeps your machine safe.

---

## 2. Target Audience

- **Individual Terminal Hackers**: Who need a fast, reliable AI assistant that integrates with their local tools.
- **Engineering Teams**: Who want to share custom coding skills and project-specific AI configurations.
- **Security-Conscious Organizations**: Who need to audit every file change or bash command an AI agent makes.

---

## 3. Core Features

### 3.1 The "Search Brain" (Zig)
- **High-speed Indexing**: 2 seconds to index 50,000 files.
- **Typo-Resistant Fuzzy Matching**: Find `product.json` by typing `prduc.js`.
- **Intelligent Ranking**: Files you've edited or that are in your current folder appear first.

### 3.2 The "Agent Heart" (Bun)
- **Fast Agent Loop**: Bun's runtime provides sub-millisecond overhead for tool execution.
- **TypeScript SDK**: Build new tools, skills, and integrations using the language you already know.
- **Native Node/Bun API Support**: Your tools can use any npm package or native Bun API.

### 3.3 The "Workflow Tree"
- **Persistent Sessions**: All history is stored in local JSONL files.
- **Branching**: Experiment with multiple approaches. `/tree` lets you jump between branches effortlessly.
- **Compaction**: Long sessions are automatically summarized to keep LLM context focused.

---

## 4. Success Metrics

- **Sub-10ms Search**: 95th percentile latency for file search.
- **Under 200ms Startup**: From command hit to interactive UI.
- **Zero-Lag Streaming**: UI rendering must maintain 60fps even during high-velocity token streaming.
- **Security Auditable**: 100% of tool executions must be logged with their capability profile.
