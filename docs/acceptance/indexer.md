# Indexer Acceptance Criteria

## Cold index
- When `search.init` is called for a workspace with no cache, the indexer performs a full crawl.
- The crawler must load ignore rules from `.gitignore`, `.ignore`, and `.geminiignore`.
- Ignore matching must be glob-aware (`*`, `**`, `?`) instead of raw substring checks.

## Warm index
- The indexer persists to `~/.pi/cache/search/<workspace_hash>/index.bin`.
- A subsequent `search.init` for the same workspace should load from cache and skip full crawl when schema matches.
- If cache magic/schema version is invalid or changed, the indexer must rebuild from source files and rewrite cache.

## Update correctness
- `search.update` accepts file-watch style events (`create`, `update`, `delete`) and applies changes incrementally.
- Incremental updates must upsert/remove only affected entries and keep unrelated entries intact.
- Delete events remove entries from results.
- Update events refresh metadata while preserving overall index size when file count is unchanged.
