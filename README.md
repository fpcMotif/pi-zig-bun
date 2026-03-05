# pi-zig-bun

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## CLI usage

```bash
bun run index.ts [command] [args...]
```

### Supported command surface

- `pi` (or `bun run index.ts`) → interactive mode.
- `pi -p "query"` / `pi --prompt "query"` → one-shot prompt/query mode.
- `pi --json "query"` → one-shot prompt/query mode with JSON output.
- `pi search <query>` → fuzzy file search.
- `pi grep <query>` → indexed content search.
- `pi tree` or `pi /tree` → show session branch heads.
- `pi /login <openai|anthropic|google> <api-key>` → validate and persist provider credentials in `.pi/config.json`.

### Examples

```bash
# one-shot prompt/query mode
bun run index.ts -p "search bridge lifecycle"

# one-shot prompt/query with JSON output
bun run index.ts --json "bridge process restart"

# file path fuzzy search
bun run index.ts search "main.ts"

# content grep search
bun run index.ts grep "search.init"

# session tree output as JSON
bun run index.ts /tree --json

# save provider credentials locally
bun run index.ts /login openai sk-xxxxxxxxxxxxxxxx
```

This project was created using `bun init` in bun v1.2.22. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Local workflow memory

- `search`/`eza` for repo inspection.
- `gemini -y p "<query>"` for fast web research when choosing tooling.
- `prek` for pre-commit enforcement.

## Git + pre-commit integration

This repo uses a pre-commit hook that delegates checks to `prek`.

```bash
# One-time setup
git config core.hooksPath .githooks
```

Before committing, run:

```bash
prek run
```

If `prek` is missing:

```bash
cargo install prek
```

Commit gate flow used by this project:
- `bunx tsc --noEmit`
- `zig build`
- `prek run`
- `bun run ci:search-regression`

GitHub Actions runs the same checks on PRs and push-to-main in `.github/workflows/ci.yml`.

## CI cache version policy

The workflow uses a cache version key (`CACHE_VERSION`) in `.github/workflows/ci.yml` to make cache invalidation explicit.
When CI behavior changes materially (dependency changes, toolchain flow changes, cache logic updates), bump this value:

```yaml
CACHE_VERSION: v3
```

This forces fresh cache entries on the next run.
