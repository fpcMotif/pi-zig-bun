# Search Bridge Performance Acceptance Criteria

## Scope

These criteria validate latency behavior after moving the search bridge to a long-lived process model.

## Process lifecycle

- The bridge process is started once and reused across multiple `call()` invocations.
- Calls are handled with a FIFO queueing policy to avoid overlapping writes while preserving deterministic request ordering.
- A health probe (`ping`) is executed before dispatching work; if probing fails, the bridge is restarted automatically.
- Shutdown attempts graceful termination first (`shutdown` request + `SIGTERM`), then escalates to force-kill only if needed.

## Latency criteria

- **Cold call budget**: the first call after process start should complete within **250 ms** on a typical developer machine (excluding expensive search workloads).
- **Warm call budget**: subsequent calls against the same running bridge should complete within **75 ms** median for lightweight methods (for example `ping`/metadata-style RPCs).
- **Warm-call stability target**: p95 warm-call latency should stay under **150 ms** during steady-state local usage.

## Reliability criteria tied to latency

- Request timeouts must remove the request from the pending map so later calls are not blocked by stale entries.
- Forced process exits must recover on the next call via restart, preserving a fast warm path after recovery.
