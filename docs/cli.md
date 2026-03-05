# CLI Reference

## Commands

- `pi` - interactive REPL mode.
- `pi -p "<query>"` / `pi --prompt "<query>"` - one-shot prompt/query mode.
- `pi --json "<query>"` - one-shot prompt/query mode with JSON output.
- `pi search <query>` - fuzzy file search.
- `pi grep <query>` - indexed grep-style content search.
- `pi tree` or `pi /tree` - session tree heads.
- `pi /login <openai|anthropic|google> <api-key>` - validate credentials and write local config.

## Examples

```bash
bun run index.ts -p "search bridge"
bun run index.ts --json "where is search.init implemented"
bun run index.ts search "src/main.ts"
bun run index.ts grep "search.init"
bun run index.ts /tree --json
bun run index.ts /login anthropic sk-ant-api03-xxxxxxxx
```

## Credential storage

`/login` writes provider credentials into:

- `<cwd>/.pi/config.json`

Current validation rules:

- `openai`: key must start with `sk-`
- `anthropic`: key must start with `sk-ant-`
- `google`: key must start with `AIza` or `gsk_`
