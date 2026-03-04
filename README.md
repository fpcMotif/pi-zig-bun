# pi-zig-bun

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.22. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.


## Requirements traceability

- Acceptance matrix: [`docs/acceptance-matrix.md`](docs/acceptance-matrix.md)
- If product requirements, spec behavior, or user stories change, update this matrix in the same PR.

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

