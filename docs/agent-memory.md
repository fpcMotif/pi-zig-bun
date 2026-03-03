# Project Memory: Future-Session Rules

## 1) Golden rule for this repo
- Prefer **Bun** for JS/TS tasks (as already required by `CLAUDE.md`).
- Keep **Zig 0.15.2** in the search backend.
- Keep transport protocol and process lifecycle stable before touching other features.

## 2) Tooling workflow (never skip)
Use this exact flow for architecture/design investigations:
1. `search` (repo-local `SearchClient` / `search.grep`) when tracing code symbols/terms.
2. `eza` for fast tree inspections when `ls` output is noisy.
3. `gemini -y p "<question>"` for web research when external docs/examples are needed (Google-backed).

## 3) Pre-commit workflow (MANDATORY)
All commits in this repo should route through `prek` (Rust tool):
1. Ensure `prek` is installed: `cargo install prek`.
2. Run:
   - `prek run` before each commit.
3. If `prek` is missing, install immediately and do not bypass it with ad-hoc checks.

## 4) Git command sequence
- Use this sequence when sharing work:
  - `bunx tsc --noEmit` (local validation)
  - `zig build` (Zig validation)
  - `prek run` (pre-commit quality gate)
  - `bun run ci:search-regression` (multi-call regression sanity)
  - `git commit` / `git push`

## 5) Session memory reminder
- Don’t forget to keep the Zig/JS boundary clean, preserve newline-delimited JSON-RPC, and avoid debug logging in final code.

## 6) CI workflow reminder
- GitHub Actions (`.github/workflows/ci.yml`) runs:
  - `bunx tsc --noEmit`
  - `zig build`
  - `prek run`
  - `bun run ci:search-regression`
- Cache policy: bump `CACHE_VERSION` (in `.github/workflows/ci.yml`) when CI/tooling behavior changes to force cache refresh on next run.
