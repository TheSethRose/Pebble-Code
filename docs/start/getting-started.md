---
title: "Getting Started"
summary: "Install Pebble from the repository, configure a provider, and run your first interactive or headless session."
read_when:
  - First-time setup from this repository
  - You want the fastest path to a working Pebble session
---

# Getting Started

Pebble currently runs from this repository rather than as a published package. The fastest path is:

1. install Bun
2. clone the repo and install dependencies
3. configure a provider credential
4. run Pebble interactively or in headless mode

## What you need

- **Bun** v1.x
- **A model provider credential** — OpenRouter is the default path, but Pebble also supports OpenAI and a broader built-in provider catalog

<Note>
If you start Pebble without a working provider configuration, it will still boot, but the runtime will tell you the selected provider is not configured.
</Note>

## Quick setup

<Steps>
  <Step title="Clone and install">
    ```bash
    git clone https://github.com/TheSethRose/Pebble-Code.git
    cd Pebble-Code
    bun install
    bun run hooks:install
    ```
  </Step>
  <Step title="Choose a credential path">
    <Tabs>
      <Tab title="Environment variable">
        ```bash
        export OPENROUTER_API_KEY=your-key-here
        ```
      </Tab>
      <Tab title="Interactive login">
        Start Pebble first, then run:

        ```text
        /login openrouter <credential>
        ```

        Pebble stores user credentials in `~/.pebble/settings.json`.
      </Tab>
    </Tabs>
  </Step>
  <Step title="Run the interactive CLI">
    ```bash
    bun run dev
    ```
  </Step>
  <Step title="Or run headless">
    ```bash
    bun run src/entrypoints/cli.tsx --headless --prompt "summarize this repository"
    ```
  </Step>
</Steps>

## What to expect on first run

- Pebble resolves the current working directory and project root.
- Provider selection is resolved from CLI flags, saved settings, environment variables, and provider defaults.
- The runtime loads local instructions and prompt files only when the working directory is trusted.
- Interactive sessions create a new chat by default; explicit resume happens through `/resume` or `--resume <session-id>`.

## Where settings live

| Path | Purpose |
| --- | --- |
| `~/.pebble/settings.json` | user overrides and saved provider credentials |
| `.pebble/project-settings.json` | project-scoped defaults committed with the repository |
| `.pebble/sessions/` | persisted session transcripts under the project root |

## Next steps

<Columns>
  <Card title="CLI overview" href="/cli" icon="terminal-square">
    Learn the fast flags, runtime options, and interactive flow.
  </Card>
  <Card title="Slash commands" href="/cli/slash-commands" icon="slash">
    See the built-in commands Pebble registers today.
  </Card>
  <Card title="Configuration" href="/concepts/configuration" icon="settings">
    Understand settings files, env vars, and provider precedence.
  </Card>
  <Card title="Providers" href="/providers" icon="bot">
    See which provider paths are runnable today and which are still catalog-only.
  </Card>
</Columns>