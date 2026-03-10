# TUI Bridge Acceptance Criteria

## Scope
Validate the Zig JSON-RPC bridge for `ui.update` and `ui.input`, and Bun-side handling of UI input notifications.

## Message schema criteria

### Pass conditions
- `ui.update` request payload contains JSON-RPC envelope and `params.view` as a string.
- `ui.update` response returns JSON-RPC success with:
  - `result.ok` boolean set to `true`.
  - `result.view` string echoing the currently applied view payload.
  - `result.queued_inputs` numeric count.
- `ui.input` request payload contains JSON-RPC envelope and:
  - `params.type` in allowed set: `text`, `enter`.
  - optional `params.text` string.
- `ui.input` success response returns `result.ok === true`.
- Valid `ui.input` also emits a JSON-RPC notification with:
  - `method: "ui.input"`
  - `params.event_type`, `params.text`, and `params.received_ms`.
- Unknown UI input event type returns JSON-RPC error object with:
  - `error.code = -32602`
  - human-readable `error.message`
  - structured `error.data` containing received and allowed event type metadata.

### Fail conditions
- Any `ui.update` or `ui.input` response is malformed JSON-RPC.
- `ui.update` does not return `ok/view/queued_inputs`.
- `ui.input` does not emit notification for accepted input events.
- Unknown input type fails without structured JSON-RPC `error.data`.

## Interaction flow criteria

### Pass conditions
1. Bun bridge starts Zig process and issues `ui.update`.
2. Zig acknowledges and stores latest view snapshot.
3. Bun sends keyboard events (`text`, `enter`) via `ui.input`.
4. Zig emits `ui.input` JSON-RPC notifications.
5. Bun handler receives notification events and can inspect `event_type/text` fields.

### Fail conditions
- Bun cannot observe emitted `ui.input` notifications.
- Keyboard events are accepted but not observable by Bun consumers.
- Notification method name diverges from `ui.input`.
