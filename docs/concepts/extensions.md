---
title: "Extensions"
summary: "How Pebble loads local extensions, skills, providers, commands, tools, and MCP server definitions."
read_when:
  - You want the current extension product surface
  - You are explaining local extension discovery or failure isolation
---

# Extensions

Pebble can load local runtime integrations from extension directories.

## Default extension directories

`src/extensions/loaders.ts` resolves these default locations:

- `extensions/`
- `.pebble/extensions/`

## What extensions can contribute

Pebble's runtime integration loader can collect:

- commands
- tools
- providers
- skills
- MCP server definitions

## Supported extension shapes

The loader supports:

- module entry files such as `index.ts`, `index.js`, `index.mjs`, or `index.cjs`
- `SKILL.md` skill packages
- MCP server definitions loaded from settings

## Failure isolation

Extension loading is intentionally isolated.

If an extension fails:

- Pebble records the failure in the integration results
- boot continues
- the failure is reported through runtime diagnostics instead of crashing the whole product

## Related pages

- [Configuration](/concepts/configuration)
- [Providers](/providers/index)
- [Help](/help/index)