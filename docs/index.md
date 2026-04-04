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

<Columns>
  <Card title="Get started" href="/start/getting-started" icon="rocket">
    Install dependencies, configure a provider, and run your first Pebble session.
  </Card>
  <Card title="Use the CLI" href="/cli" icon="terminal-square">
    Fast flags, interactive usage, headless mode, and slash commands.
  </Card>
  <Card title="Configure Pebble" href="/concepts/configuration" icon="settings">
    Settings files, provider auth, env vars, and runtime precedence.
  </Card>
  <Card title="Troubleshoot" href="/help/troubleshooting" icon="wrench">
    Fix provider auth, trust, session, and extension-loading issues quickly.
  </Card>
</Columns>

## What Pebble is for

Pebble is built for people who want a coding agent that feels good in a terminal **and** behaves predictably in automation.

Compared with a one-shot CLI wrapper, Pebble keeps more of the useful agent runtime intact:

- **Multi-turn execution** — the model can call tools, react to results, and continue.
- **Session persistence** — conversations are written to disk so you can resume them later.
- **Headless integration** — scripts can consume plain text, JSON, or NDJSON event streams.
- **Configurable providers** — OpenRouter is the default, but Pebble ships a larger provider catalog and per-provider credential storage.
- **Local extension loading** — commands, tools, skills, providers, and MCP servers can be discovered from local extension directories.

## Product surface

<Columns>
  <Card title="Interactive REPL" href="/cli" icon="message-square">
    Run Pebble in the terminal, stream results live, and use slash commands for config, resume, memory, and review tasks.
  </Card>
  <Card title="Headless mode" href="/cli/headless" icon="workflow">
    Run Pebble non-interactively with `--headless`, `--prompt`, and structured output formats.
  </Card>
  <Card title="SDK" href="/sdk" icon="code-2">
    Use the package-root SDK helpers such as `runSdk`, `runHeadless`, `query`, `streamQuery`, and `QueryEngine`.
  </Card>
  <Card title="Providers" href="/providers" icon="bot">
    Configure OpenRouter, OpenAI, and the broader built-in provider catalog without silently falling back to a different provider.
  </Card>
</Columns>

## Quick start

<Steps>
  <Step title="Install repository dependencies">
    ```bash
    git clone https://github.com/TheSethRose/Pebble-Code.git
    cd Pebble-Code
    bun install
    bun run hooks:install
    ```
  </Step>
  <Step title="Configure a provider credential">
    Set `OPENROUTER_API_KEY` in your environment, or launch Pebble and use `/login openrouter <credential>`.
  </Step>
  <Step title="Start Pebble">
    ```bash
    bun run dev
    ```
  </Step>
</Steps>

Need the guided version? Go to [Getting Started](/start/getting-started).