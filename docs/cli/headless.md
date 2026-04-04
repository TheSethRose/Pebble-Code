---
title: "Headless Mode"
summary: "Use Pebble without the UI and consume plain text, JSON, or NDJSON event streams."
read_when:
  - You are scripting Pebble
  - You want the exact stdout event behavior implemented by the headless reporter
---

# Headless Mode

Headless mode bypasses the Ink UI and runs Pebble directly through the runtime and engine layers.

Use it when you want:

- automation from shell scripts
- machine-readable output
- CI or workflow integrations
- to reuse the same session and provider logic without the interactive UI

## Basic command

```bash
bun run src/entrypoints/cli.tsx --headless --prompt "summarize the repository"
```

## Output formats

Pebble supports three output formats through `--format`.

### `text` (default)

- assistant text is written to `stdout`
- startup diagnostics remain on `stderr`

### `json`

- one terminal JSON result envelope is written to `stdout`
- the envelope includes `type`, `status`, `message`, `sessionId`, and optional `data`

### `json-stream`

- Pebble writes NDJSON events to `stdout`
- each line is one serialized SDK event

The main event types are:

| Event type | Meaning |
| --- | --- |
| `init` | session id, provider, model, and cwd are ready |
| `user_replay` | echo of the submitted prompt |
| `stream_event` | wrapped engine event such as `progress`, `tool_call`, `tool_result`, `text_delta`, or `done` |
| `permission_denied` | a tool could not run under the current permission policy |
| `result` | terminal status envelope |

## Examples

```bash
# Plain text
bun run src/entrypoints/cli.tsx --headless --prompt "hello"

# Single JSON envelope
bun run src/entrypoints/cli.tsx --headless --prompt "hello" --format json

# NDJSON stream
bun run src/entrypoints/cli.tsx --headless --prompt "hello" --format json-stream
```

## Permission behavior

Headless mode still uses Pebble's permission system.

- if a tool can run under the configured `permissionMode`, it runs normally
- if it cannot, Pebble emits a `permission_denied` event in `json-stream` mode
- text mode surfaces the resulting assistant output or failure message, not an interactive approval prompt

<Warning>
Pebble does **not** currently expose a CLI `--auto-approve` flag in `src/entrypoints/cli.tsx`. Permission behavior comes from runtime settings, not a dedicated headless flag.
</Warning>

## Related pages

- [CLI overview](/cli)
- [SDK](/sdk)
- [Trust and permissions](/concepts/trust-and-permissions)