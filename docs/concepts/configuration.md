---
title: "Configuration"
summary: "How Pebble resolves settings, credentials, models, base URLs, and project defaults."
read_when:
  - You want the actual config paths and precedence used by the runtime
  - You are documenting provider selection or saved settings behavior
---

# Configuration

Pebble combines **project defaults**, **user overrides**, **environment variables**, and **CLI overrides**.

## Settings locations

| Path | Purpose |
| --- | --- |
| `~/.pebble/settings.json` | user-level settings and saved credentials |
| `.pebble/project-settings.json` | project-scoped defaults |
| `PEBBLE_HOME` | optional override for the Pebble home directory |

Project defaults are the right place for shared repository settings such as `provider`, `model`, `maxTurns`, `fullscreenRenderer`, and `shellCompactionMode`.

## Provider resolution rules

Provider runtime selection is resolved in `src/providers/config.ts` and `src/providers/runtime.ts`.

### Provider id

Provider selection follows this order:

1. `--provider`
2. `settings.provider`
3. `PEBBLE_PROVIDER`
4. built-in default (`openrouter`)

### Model

Model selection follows this order:

1. `--model`
2. `settings.model`
3. provider-specific model env vars (for example `OPENROUTER_MODEL`)
4. provider default model

### Base URL

Base URL selection follows this order:

1. `settings.baseUrl`
2. provider-specific base URL env vars
3. provider default base URL

### Credentials

Credential resolution follows this order:

1. saved provider credential in settings
2. saved OAuth token/session material in settings
3. provider-specific env vars
4. provider default marker credential (for local-style providers that define one)

## How Pebble writes settings

- `/login` stores credentials in `~/.pebble/settings.json`
- the settings UI also writes user overrides there
- project defaults stay in `.pebble/project-settings.json`
- legacy workspace `.pebble/settings.json` files are migrated into `~/.pebble/settings.json`

<Note>
Pebble intentionally separates committed project defaults from user secrets. Project settings are sanitized so credentials are not written into `.pebble/project-settings.json`.
</Note>

## Shared project defaults

This repository now commits `shellCompactionMode` in `.pebble/project-settings.json`:

```json
{
  "shellCompactionMode": "auto"
}
```

Use this setting to control how `ShellTool` summarizes noisy command output:

- `off` — return raw shell output, only truncating when needed
- `auto` — recommended default; compact common git, test, and diagnostics commands
- `aggressive` — use shorter summaries for supported command families

If the setting is omitted, Pebble falls back to the built-in default in `src/runtime/config.ts`.

## Common flows

### Switch provider for one run

```bash
bun run src/entrypoints/cli.tsx --provider openai --model gpt-4o-mini
```

### Save a credential interactively

```text
/login openrouter <credential>
```

### Use project defaults

Create `.pebble/project-settings.json` with shared defaults such as model, max turns, provider selection, or shell compaction behavior.

## Related pages

- [Providers](/providers/index)
- [Trust and permissions](/concepts/trust-and-permissions)
- [Slash commands](/cli/slash-commands)