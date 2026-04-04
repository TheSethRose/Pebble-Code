---
title: "Pebble Code"
summary: "Pebble is a terminal-native AI coding agent with an interactive REPL, headless execution, resumable sessions, provider switching, and local extensions."
read_when:
  - You want the product overview
  - You are preparing a Mintlify landing page for Pebble
---

# Pebble Code

Pebble is a **terminal-native AI coding agent** for local workflows and automation pipelines.

It gives you:

- an interactive terminal UI powered by Ink
- a headless mode for scripts and CI-style integrations
- resumable sessions stored on disk
- provider switching and per-provider auth storage
- a permission-aware tool loop with local extensions, skills, and MCP servers

## Start here

- [Getting Started](/start/getting-started) — install dependencies, configure a provider, and run Pebble
- [Docs Directory](/start/docs-directory) — quick links to the most useful product docs
- [Docs Hubs](/start/hubs) — full map of the current documentation set

## Jump to a section

### Use Pebble

- [CLI overview](/cli/index)
- [Headless mode](/cli/headless)
- [Slash commands](/cli/slash-commands)
- [SDK](/sdk/index)

### Configure Pebble

- [Configuration](/concepts/configuration)
- [Sessions](/concepts/sessions)
- [Trust and permissions](/concepts/trust-and-permissions)
- [Extensions](/concepts/extensions)
- [Providers](/providers/index)

### Get help

- [Help](/help/index)
- [Troubleshooting](/help/troubleshooting)

## What Pebble is for

Pebble is built for people who want a coding agent that feels good in a terminal **and** behaves predictably in automation.

Compared with a one-shot CLI wrapper, Pebble keeps more of the useful agent runtime intact:

- **Multi-turn execution** — the model can call tools, react to results, and continue.
- **Session persistence** — conversations are written to disk so you can resume them later.
- **Headless integration** — scripts can consume plain text, JSON, or NDJSON event streams.
- **Configurable providers** — OpenRouter is the default, but Pebble ships a larger provider catalog and per-provider credential storage.
- **Local extension loading** — commands, tools, skills, providers, and MCP servers can be discovered from local extension directories.

## Product surface

Pebble has four main product surfaces:

- **Interactive REPL** — use [CLI overview](/cli/index) to run Pebble in the terminal and work with slash commands, settings, and session resume.
- **Headless mode** — use [Headless mode](/cli/headless) for non-interactive runs and structured output.
- **SDK** — use [SDK](/sdk/index) for programmatic entrypoints like `runSdk`, `runHeadless`, `query`, and `streamQuery`.
- **Providers** — use [Providers](/providers/index) to configure OpenRouter, OpenAI, and the current built-in provider catalog.

## Quick start

1. Clone the repository and install dependencies.

   ```bash
   git clone https://github.com/TheSethRose/Pebble-Code.git
   cd Pebble-Code
   bun install
   bun run hooks:install
   ```

2. Configure a provider credential.

   - Set `OPENROUTER_API_KEY` in your environment, or
   - launch Pebble and run `/login openrouter <credential>`

3. Start Pebble.

   ```bash
   bun run dev
   ```

Need the guided version? Go to [Getting Started](/start/getting-started).