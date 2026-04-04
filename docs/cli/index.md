---
title: "CLI Overview"
summary: "How to run Pebble interactively, which fast flags exist, and which runtime options the CLI accepts today."
read_when:
  - You are learning the Pebble CLI surface
  - You want the real flag set implemented by src/entrypoints/cli.tsx
---

# CLI Overview

Pebble has two main CLI modes:

- **interactive** — launches the Ink terminal app
- **headless** — runs without the UI and writes results to stdout

## Fast flags

These flags are handled directly in `src/entrypoints/cli.tsx` without booting the full runtime.

| Flag | Effect |
| --- | --- |
| `--version`, `-v` | print the version and exit |
| `--help`, `-h` | print help and exit |
| `--features` | print the feature summary and enabled flags |
| `--build-info` | print bundle metadata as JSON |

## Runtime flags

These options are passed into `run()` in `src/runtime/main.ts`.

| Flag | Effect |
| --- | --- |
| `--headless`, `-p` | run without the Ink UI |
| `--prompt <text>` | provide the prompt for headless mode |
| `--resume <id>` | resume a specific persisted session |
| `--model <name>` | override the selected model for this run |
| `--provider <name>` | override the selected provider for this run |
| `--format <type>` | choose `text`, `json`, or `json-stream` output in headless mode |
| `--cwd <path>` | set the working directory |

## Interactive usage

Run Pebble from source:

```bash
bun run dev
```

Once the UI is open, Pebble lets you:

- type prompts directly into the REPL
- open settings with `/config` or `/provider`
- save credentials with `/login`
- inspect or refresh session memory with `/memory`
- resume a previous session with `/resume`

<Note>
Fresh interactive launches do **not** auto-resume the latest session today. Resume is explicit through `/resume` or `--resume <session-id>`.
</Note>

## Examples

```bash
# Start the interactive UI
bun run dev

# Headless text output
bun run src/entrypoints/cli.tsx --headless --prompt "summarize README.md"

# Headless JSON result envelope
bun run src/entrypoints/cli.tsx --headless --prompt "status" --format json

# Resume a saved session by id
bun run src/entrypoints/cli.tsx --resume abc123
```

## Related pages

- [Headless mode](/cli/headless)
- [Slash commands](/cli/slash-commands)
- [Sessions](/concepts/sessions)