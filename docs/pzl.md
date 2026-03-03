# Review Notes: What We Learned, Weaknesses, and Future Improvements

## What I learned

- **Workflow consistency beats local-only checks**: Aligning local and CI checks (`bunx tsc --noEmit`, `zig build`, `prek run`, regression script) gave a much more reliable project flow.
- **Process lifetime contracts matter**: The per-call Zig bridge lifecycle is stable when bounded by explicit request flow and one-call startup/shutdown behavior.
- **Cache invalidation needs an intentional switch**: A `CACHE_VERSION` variable in CI avoids confusing stale-cache behavior and makes invalidation predictable.
- **Documented agent memory is valuable**: Updating `README.md` + memory docs reduces repeated setup ambiguity for future sessions.

## Weaknesses / risk areas

- `SKIP_PREK=1` bypass exists (for emergency use) and can be misused, potentially hiding required checks.
- Regression coverage is still narrow (currently mostly happy-path calls).
- No direct memory-leak assertion in CI yet; functional checks can still pass while allocations regress.
- Per-call restart is stable, but not always best for raw throughput in very high-volume usage.
- Cache invalidation via `CACHE_VERSION` still depends on human discipline to bump correctly when behavior changes.

## Future improvements / innovation ideas

1. Expand CI regression coverage to cover malformed JSON-RPC and error scenarios (invalid payloads, bad paths, permission-edge cases).
2. Add allocator/behavioral checks for leak-sensitive paths (or an automated sanitizer step where available).
3. Add performance regression checks (latency and throughput baselines for repeated `search.files` / `search.grep`).
4. Externalize cache policy to a dedicated file (e.g., `ci/cache-version.txt`) and read it in workflow for less human error.
5. Add optional logs/artifacts for failed CI script runs to aid diagnosis.
6. Consider a long-lived bridge mode behind a feature flag for throughput-heavy workloads if and when needed.
