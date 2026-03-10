# CLI Surface Acceptance Criteria

The following commands define the expected CLI behavior.

## One-shot search print mode (`-p`)

```bash
pi-zig-bun -p "needle"
```

Expected output shape:

```text
<score>  <path>  (<matchType>)
... (up to --limit entries)
```

## One-shot JSON mode (`--json "query"`)

```bash
pi-zig-bun --json "needle"
```

Expected output shape:

```json
{"query":"needle","results":[...],"stats":...}
```

## Search subcommand

```bash
pi-zig-bun search "needle"
```

Expected output shape:

```text
<score>  <path>  (<matchType>)
```

## Grep subcommand

```bash
pi-zig-bun grep "needle"
```

Expected output shape:

```text
<path>:<line>:<column>  <line text>
```

## Tree subcommand

```bash
pi-zig-bun tree
```

Expected output shape:

```text
Session heads: <n>
<id> | parent=<id|<root>> | <ISO timestamp>
```

## Login command surface (deferred)

```bash
pi-zig-bun /login
```

Expected output:

```json
{"ok":false,"command":"/login","code":"NOT_SUPPORTED","message":"Login/auth setup is not implemented yet in pi-zig-bun."}
```
