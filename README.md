# Pebble Code

> Great things start with the smallest pieces.

**Pebble Code** is a terminal-native AI coding agent for power users and automation pipelines. It gives you a fast interactive REPL, a headless execution mode, a multi-turn agent loop with real tool use, durable session persistence, and an explicit trust-aware permission model — all in a single binary.

Most AI coding CLIs fall short in one or more of the same ways: slow startup for simple invocations, poor separation between interactive and scripted workflows, weak permission and trust boundaries, no durable session model for long-running work, and fragile or nonexistent extensibility.

Pebble Code solves those problems. It is designed to feel immediate, controllable, resumable, and extensible — whether you are working interactively in a terminal or orchestrating it from a CI pipeline.

---

## Features

- **Interactive REPL** — Full terminal UI powered by React and Ink. Streams model responses and tool results in real time.
- **Headless / SDK mode** — Run non-interactively from scripts, CI/CD pipelines, or programmatic integrations via structured JSON or NDJSON output.
- **Multi-turn agent loop** — The model reasons across multiple turns, calls tools, reacts to results, and continues until done.
- **Persistent sessions** — Transcripts are written to disk incrementally. Resume exactly where you left off.
- **Context compaction** — Long sessions are automatically summarized to stay within model context limits without losing the local transcript.
- **Trust & permission model** — Explicit directory trust prompts on first use. Risky tool calls require approval. `--bare` mode disables all dynamic loaders.
- **Layered configuration** — Merges defaults, global config, project config, environment variables, and CLI flags in a predictable override chain.
- **Repository instructions** — Automatically loads project-level conventions (e.g., `AGENTS.md`) into the system prompt.
- **Extensible** — Skills, plugins, slash commands, and MCP server integrations are first-class extension points.
- **Privacy-first** — No mandatory telemetry. Model calls go directly to your configured provider.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.com) v1.x |
| Language | TypeScript (strict) |
| Terminal UI | [Ink](https://github.com/vadimdemedes/ink) + React 19 |
| Schema validation | [Zod](https://zod.dev) |
| Default model provider | [OpenRouter](https://openrouter.ai) |
| Build | Bun bundler (`bun build`) |
| Linting / formatting | [Biome](https://biomejs.dev) |

---

## Getting Started

### Prerequisites

- [Bun](https://bun.com) v1.x

### Install

```bash
git clone https://github.com/TheSethRose/Pebble-Code.git
cd Pebble-Code
bun install
```

### Run locally

```bash
# Interactive REPL
bun run dev

# Or build and run the binary
bun run build
bun run start
```

---

## Configuration

### Environment variables

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | API key for OpenRouter (default provider) |
| `OPENAI_API_KEY` | API key for OpenAI (if switching providers) |

### Config files

Pebble resolves configuration in this order (highest wins):

1. CLI flags (e.g., `--provider openai`)
2. Environment variables
3. Project config — `.pebble/config.json` in the repo root
4. Global config — `~/.pebble/config.json`
5. Built-in defaults

### Setting your API key

```bash
# Option 1: environment variable
export OPENROUTER_API_KEY=your-key-here

# Option 2: REPL command (persists to .pebble/settings.json)
/login your-key-here

# Option 3: inspect and update config interactively
/config
```

### Trust model

On first use in a new directory, Pebble prompts for explicit trust authorization. Untrusted directories ignore project-scoped configs, hooks, and auto-allow rules.

```bash
# Disable all dynamic instruction loaders
pebble --bare
```

---

## Usage

### Interactive REPL

Start the agent and type naturally. The model reasons over multiple turns, calls tools as needed, and streams results back to the terminal.

**Slash commands:**

| Command | Description |
|---|---|
| `/help` | List all available commands |
| `/config` | View and update provider, model, and base URL |
| `/login <key>` | Save an API key to project settings |
| `/resume` | Resume the previous session |
| `/clear` | Clear the current context |
| `/exit` | Exit the REPL |

### Session resume

Every session is persisted to disk automatically.

```bash
# Resume the most recent session (default behavior on next launch)
pebble

# Resume a specific session by ID
pebble --resume <session-id>
```

### Headless / scripting mode

```bash
# Plain text output
pebble --headless --prompt "summarize the README"

# Single JSON result envelope
pebble --headless --prompt "list all exported functions" --format=json

# Streaming NDJSON (one event per line)
pebble --headless --prompt "refactor this file" --format=json-stream

# Pre-approve safe tool categories
pebble --headless --auto-approve=read,write --prompt "..."
```

Headless mode emits structured lifecycle events: `init`, `stream_event`, `permission_denied`, and a terminal `result` envelope.

### Programmatic SDK

```ts
import { createSession } from "pebble-code"

const session = await createSession({ prompt: "explain this codebase" })
for await (const event of session.stream()) {
  console.log(event)
}
```

### Built-in tools

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

## Project Structure

```
src/
  build/        # Build metadata and feature flags
  commands/     # Slash-command types, built-ins, and registry
  constants/    # Shared constants and provider defaults
  engine/       # Multi-turn query loop, transitions, and SDK protocol
  entrypoints/  # CLI and SDK bootstraps
  extensions/   # Extension contracts and loaders
  persistence/  # Session storage, compaction, memory, and todo state
  providers/    # Provider config and model/provider adapters
  runtime/      # Trust, config, instructions, permissions, session wiring
  tools/        # Tool contracts, registries, and built-in implementations
  ui/           # Ink app state, settings, and terminal components
tests/          # Subsystem-oriented tests (build, runtime, tools, UI, entrypoints)
docs/           # Architecture, PRD, and reference documentation
scripts/        # Build and automation helpers
```

**Key dependency flow:**

- `entrypoints/` stays thin — delegates immediately to `runtime/`
- `runtime/` orchestrates trust, config, providers, extensions, and session state
- `engine/` is the execution core — UI-free, provider-agnostic
- `tools/` exposes permission-aware capabilities to the engine
- `ui/` consumes runtime state and engine events; owns no policy or storage

### Extensibility

**Skills** — Domain-specific behavior packages that inject system prompt fragments and local constraints. Loaded from user or project directories.
**Plugins** — Modules that add custom slash commands, tools, or alternative renderers. Registered via `src/commands/registry.ts` and `src/tools/registry.ts`.
**MCP (Model Context Protocol)** — Pebble acts as an MCP client. Define external tool servers in config and they appear as native tools inside the agent loop.

---

## Status / Roadmap

**Current status:** `v0.1.0` — early release. Core interactive REPL, headless mode, session persistence, and trust model are stable.

### Stable
- Interactive REPL and headless execution
- Session persistence and resume
- Trust and permission gating
- Layered configuration
- Repository instruction loading
- Built-in tool suite

### Planned
- Full MCP client support (dynamic tool servers)
- Dynamic plugin loading
- Git worktree-based workflows
- Background sessions
- Session forking (branch a conversation at any point)
- Point-in-time session resume
- Web fetch and web search tools
- Jupyter notebook editing

### Known limitations
- MCP and plugin loading are interface-reserved but not fully wired in this release
- Web tools (`WebFetch`, `WebSearch`) are not enabled by default

---

## Contributing

Contributions are welcome. Please follow these guidelines:

1. Fork the repository and branch from `main` using the format `feat/`, `fix/`, or `docs/` followed by a short description.
2. Run `bun run typecheck` and `bun run build` before opening a PR — do not submit if either fails.
3. Use atomic commits with the format: `type: short description` followed by bullet-point details.
4. Open a PR against `main` with a clear description of what changed and why.
5. Keep changes focused — one concern per PR.

---

## License

MIT License — see [LICENSE](LICENSE) for full terms.

---

## Support / Contact

Open an issue in the [GitHub repository](https://github.com/TheSethRose/Pebble-Code/issues) for bug reports, questions, or feature requests.
