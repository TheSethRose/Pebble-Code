---
title: "Slash Commands"
summary: "Built-in interactive slash commands available in Pebble today."
read_when:
  - You want the actual commands registered in src/commands/builtins.ts
  - You are documenting the interactive REPL surface
---

# Slash Commands

Pebble registers its built-in interactive commands in `src/commands/builtins.ts`.

## Core commands

| Command | What it does |
| --- | --- |
| `/help` | opens the keybindings/help overlay |
| `/clear` | clears the current conversation state |
| `/exit` | exits Pebble |
| `/config` | opens the settings UI |
| `/provider` | opens the provider tab in settings |
| `/model [model-name]` | opens the model picker, or saves a new model override when an argument is provided |
| `/login [provider] <credential>` | saves a provider credential when the provider supports manual credential entry |
| `/resume [session-id]` | resumes the latest session or a specific session id |
| `/memory [refresh|clear]` | shows, refreshes, or clears persisted session memory |
| `/permissions` | shows the current permission mode and recent decisions |
| `/plan [description]` | stores or prints a lightweight plan note |
| `/review` | prints git status plus staged/unstaged diff summaries |
| `/sidebar` | toggles the session sidebar in the interactive UI |

## Notes and constraints

- `/help`, `/config`, `/provider`, and `/sidebar` are UI-oriented commands.
- `/review` and `/sidebar` require a trusted or bare trust level.
- `/login` refuses providers that require OAuth, IAM, or other non-manual auth flows instead of pretending a pasted API key will work.

## Examples

```text
/login openrouter sk-or-v1-...
/model gpt-4o-mini
/resume
/memory refresh
/review
```

## Aliases

Some commands also register short aliases:

- `/h`, `/?` → `/help`
- `/cls` → `/clear`
- `/quit`, `/q` → `/exit`
- `/settings` → `/config`
- `/p` → `/provider`
- `/m` → `/model`
- `/continue` → `/resume`
- `/mem` → `/memory`
- `/perms`, `/trust` → `/permissions`
- `/think` → `/plan`
- `/check` → `/review`

## Related pages

- [CLI overview](/cli)
- [Sessions](/concepts/sessions)
- [Configuration](/concepts/configuration)