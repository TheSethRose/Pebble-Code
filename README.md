# Pebble Code

> Great things start with the smallest pieces.

**Pebble Code** is a terminal-native AI coding agent built for power users and automation pipelines. It combines a fast interactive REPL, a headless execution mode, a multi-turn agent loop with real tool use, durable session persistence, and a trust-aware permission model — all in a single binary.

---

## Features

- **Interactive REPL** — Full terminal UI powered by React and Ink. Streams model responses and tool results in real time.
- **Headless / SDK mode** — Run non-interactively from scripts, CI/CD pipelines, or programmatic integrations.
- **Multi-turn agent loop** — The model reasons across multiple turns, calls tools, reacts to results, and continues until done.
- **Persistent sessions** — Transcripts are written to disk incrementally. Resume exactly where you left off.
- **Trust & permission model** — Explicit directory trust prompts on first use. Risky tool calls require approval. `--bare` mode disables all dynamic loaders.
- **Layered configuration** — Merges defaults, global config, project config, environment variables, and CLI flags in a predictable override chain.
- **Repository instructions** — Automatically loads project-level conventions (e.g., `AGENTS.md`) into the system prompt.
- **Extensible** — Skills, plugins, slash commands, and MCP server integrations are first-class extension points.
- **Privacy-first** — No mandatory telemetry. Model calls go directly to your configured provider.

---

## Built-in Tools

| Tool | Description |
|---|---|
| `BashTool` | Execute shell commands with explicit trust gating |
| `FileReadTool` | Read file contents |
| `FileEditTool` | Apply targeted edits to existing files |
| `FileWriteTool` | Write new files |
| `GlobTool` | Find files by pattern |
| `GrepTool` | Search file contents |
| `TodoTool` | Manage structured task lists across a session |
| `MemoryTool` | Persist and retrieve cross-session notes |
| `OrchestrateTool` | Spawn and coordinate sub-agent tasks |

---

## Getting Started

### Prerequisites

- [Bun](https://bun.com) v1.x

### Install

```bash
bun install
```

### Configure a provider

Pebble defaults to **OpenRouter**. Set your API key using any of:

```bash
# Option 1: environment variable
export OPENROUTER_API_KEY=your-key-here

# Option 2: REPL command (saves to .pebble/settings.json)
/login your-key-here

# Option 3: inspect and update config interactively
/config
```

Environment variables for other providers are also supported (e.g., `OPENAI_API_KEY`).

### Run

```bash
# Interactive REPL
bun run dev

# Or run the built binary
bun run start
```

---

## Headless & SDK Mode

Run Pebble non-interactively for scripting or automation:

```bash
# Plain text output
pebble --headless --prompt "summarize the README"

# Single JSON result envelope
pebble --headless --prompt "list all exported functions" --format=json

# Streaming NDJSON (one event per line)
pebble --headless --prompt "refactor this file" --format=json-stream
```

Headless mode emits structured events: `init`, `stream_event`, `permission_denied`, and a terminal `result` envelope. Risky tools require explicit trust grants at startup:

```bash
pebble --headless --auto-approve=read,write
```

### Programmatic SDK

Import the SDK entrypoint directly:

```ts
import { createSession } from "pebble-code"

const session = await createSession({ prompt: "explain this codebase" })
for await (const event of session.stream()) {
  console.log(event)
}
```

---

## Session Resume

Every session is persisted to disk automatically.

```bash
# Resume the most recent session
pebble

# Resume a specific session by ID
pebble --resume <session-id>
```

Long sessions are managed automatically via context compaction — earlier tool outputs are summarized to stay within model context limits without losing the local transcript.

---

## Slash Commands

| Command | Description |
|---|---|
| `/help` | List all available commands |
| `/config` | View and update provider, model, and base URL |
| `/login <key>` | Save an API key to project settings |
| `/resume` | Resume the previous session |
| `/clear` | Clear the current context |
| `/exit` | Exit the REPL |

---

## Extensibility

### Skills
Domain-specific behavior packages that inject system prompt fragments and local constraints. Loaded from user or project directories.

### Plugins
Modules that add custom slash commands, tools, or alternative renderers. Interfaces are registered via `src/commands/registry.ts` and `src/tools/registry.ts`.

### MCP (Model Context Protocol)
Pebble acts as an MCP client. Define external tool servers in config and they are automatically available as native tools inside the agent loop.

---

## Configuration Reference

Pebble resolves configuration in this order (highest wins):

1. CLI flags (e.g., `--provider openai`)
2. Environment variables (e.g., `OPENROUTER_API_KEY`)
3. Project config (`.pebble/config.json`)
4. Global config (`~/.pebble/config.json`)
5. Built-in defaults

---

## Trust Model

On first use in a new directory, Pebble prompts for explicit trust authorization. Untrusted directories ignore project-scoped configs, hooks, and auto-allow rules.

```bash
# Disable all dynamic instruction loaders
pebble --bare
```

---

## Development

```bash
# Run tests
bun test

# Type-check
bun run typecheck

# Lint and format
bun run lint

# Build binary
bun run build
```

---

## License

Private. All rights reserved.
