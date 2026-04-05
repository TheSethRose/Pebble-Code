---
title: "Pebble Codebase Tree"
summary: "Repository map for the tracked, non-ignored surfaces of Pebble Code."
read_when:
  - You need a fast mental model of the tracked repository structure
  - You are moving files or changing ownership boundaries in src/, tests/, scripts/, or docs/
---

# Pebble Codebase Tree

## Scope

This page documents the tracked repository surface and intentionally excludes paths ignored by `.gitignore`.

## Top-level tree

- `.githooks/` — committed Git safety hooks that invoke the shared secret-check script.
- `docs/` — tracked codebase documentation for non-ignored repository areas.
- `scripts/` — build and repository workflow helpers.
- `src/` — product implementation.
- `tests/` — subsystem-oriented Bun test suite.
- `AGENTS.md` — repository workflow and architecture guidance for coding agents.
- `README.md` — product-facing overview and contributor entry point.
- `index.ts` — package-root SDK re-export.
- `package.json` — package metadata, scripts, exports, and runtime dependencies.
- `tsconfig.json`, `bunfig.toml`, `biome.json` — TypeScript, Bun test, and formatting configuration.

## Source map

| Path | Responsibility | Key files |
| --- | --- | --- |
| `src/build/` | Build metadata and feature flags used by CLI/runtime and bundle output | `buildInfo.ts`, `featureFlags.ts` |
| `src/commands/` | Slash-command types, built-ins, and registration logic | `builtins.ts`, `registry.ts`, `types.ts` |
| `src/constants/` | Shared provider/runtime constants | `openrouter.ts` |
| `src/engine/` | Multi-turn query loop, transitions, result types, and SDK protocol | `QueryEngine.ts`, `query.ts`, `sdkProtocol.ts`, `types.ts` |
| `src/entrypoints/` | CLI and SDK entrypoints | `cli.tsx`, `sdk.ts` |
| `src/extensions/` | Extension contracts and runtime loaders | `contracts.ts`, `loaders.ts` |
| `src/persistence/` | Session store, compaction, memory, and runtime session helpers | `sessionStore.ts`, `runtimeSessions.ts`, `compaction.ts`, `memory.ts` |
| `src/providers/` | Provider catalog, config resolution, and runtime provider assembly | `catalog.ts`, `config.ts`, `runtime.ts`, `types.ts`, `primary/` |
| `src/runtime/` | Boot orchestration, trust, settings, hooks, permissions, reporters, and worktrees | `main.ts`, `config.ts`, `trust.ts`, `permissionManager.ts`, `reporters.ts` |
| `src/tools/` | Built-in tool implementations, orchestration, registry, and shared contracts | `orchestration.ts`, `registry.ts`, `Tool.ts`, `*/index.ts` |
| `src/ui/` | Ink UI state, prompt flow, transcript rendering, settings, and sidebar behavior | `App.tsx`, `Settings.tsx`, `components/` |

## Runtime dependency flow

- `src/entrypoints/cli.tsx` handles fast flags and then delegates to `src/runtime/main.ts`.
- `src/runtime/main.ts` builds config, trust, instructions, extensions, provider selection, and interactive/headless mode selection.
- `src/engine/QueryEngine.ts` owns the multi-turn execution loop used by both CLI and SDK paths.
- `src/tools/orchestration.ts` assembles the default capability-style tool surface.
- `src/ui/App.tsx` consumes runtime state and engine stream events for the interactive REPL.
- `src/persistence/runtimeSessions.ts` converts between stored transcripts and engine/UI message shapes.

## Test map

| Test file group | Coverage |
| --- | --- |
| `tests/entrypoints.test.ts`, `tests/runtime.test.ts` | startup, runtime behavior, and execution-mode expectations |
| `tests/engine.test.ts`, `tests/tools.test.ts`, `tests/commands.test.ts` | engine loops, tool behavior, and slash-command logic |
| `tests/provider-config.test.ts`, `tests/extensions.test.ts`, `tests/trust.test.ts`, `tests/persistence.test.ts` | provider config, extension loading, trust model, and durable session behavior |
| `tests/build.test.ts`, `tests/git-hooks.test.ts`, `tests/settings-flow.test.ts` | build pipeline, hook safety, and settings/config flows |
| `tests/ui-*.test.ts`, `tests/ui-*.test.tsx` | transcript rendering, sidebar interactions, prompt input, dialog behavior, and mouse support |

## Repo workflow surfaces

- `package.json` exposes the primary commands: `dev`, `build`, `hooks:install`, `lint`, `clean`, `typecheck`, `test`, and `start`.
- `scripts/build.ts` typechecks, bundles, verifies the built CLI, and generates the feature manifest.
- `scripts/install-git-hooks.ts` sets local `core.hooksPath` to `.githooks`.
- `.githooks/pre-commit` and `.githooks/pre-push` both route through `scripts/check-no-staged-provider-secrets.ts`.# Pebble Codebase Tree

## Purpose

Keep a durable tree-view map of the Pebble repository. Track what each major area owns, how subsystems connect, and which structural cleanup targets are next.

## Top-level tree

- `.github/agents/` — workspace-scoped custom agents for repeatable repository workflows.
- `.github/instructions/` — file-scoped instructions that keep recurring work consistent.
- `.github/skills/` — reusable workflow bundles, assets, and templates for on-demand repository tasks.
- `src/build/` — build metadata, feature flags, and bundle-time information.
- `src/commands/` — slash-command types, built-ins, and command registry composition.
- `src/constants/` — shared constants and provider defaults.
- `src/engine/` — multi-turn query loop, transitions, result shapes, and SDK protocol helpers.
- `src/entrypoints/` — CLI and SDK bootstraps.
- `src/extensions/` — extension contracts and loaders.
- `src/persistence/` — session storage, compaction, memory, and todo persistence.
- `src/providers/` — built-in provider catalog, config resolution, runtime selection, and model/provider adapters.
- `src/runtime/` — trust, config, instructions, permissions, worktrees, and background-session wiring.
- `src/tools/` — host tool contracts, registries, and built-in tool implementations.
- `src/ui/` — Ink app state, settings, and terminal components.
- `tests/` — subsystem-oriented verification for build, runtime, tools, UI, and entrypoints.
- `docs/` — architecture, product/reference docs, documentation-suite navigation, and external context snapshots.
- `scripts/` — repository build/automation helpers.

## Module map

| Path | Responsibility | Key dependencies | Consumers | Cleanup notes |
| --- | --- | --- | --- | --- |
| `src/entrypoints/` | Keep startup paths thin and mode-specific. | `src/runtime/`, `src/engine/`, `src/ui/` | CLI users, SDK callers | Avoid leaking CLI parsing into runtime or engine layers. |
| `src/runtime/` | Assemble config, trust, permissions, and session/runtime wiring. | `src/persistence/`, `src/extensions/`, `src/providers/` | `src/entrypoints/`, `src/ui/` | Keep policy here; avoid UI-specific behavior creeping inward. |
| `src/providers/` | Normalize built-in provider ids, resolve env/settings defaults, expose runtime provider selection, and host transport adapters. | provider catalog/config, `openai` SDK | `src/runtime/`, `src/ui/`, `src/engine/` | Keep catalog/config truth centralized so provider switching does not leak stale defaults across the runtime. |
| `src/engine/` | Run provider/tool conversation loops and emit structured events/results. | `src/tools/`, `src/providers/`, `src/persistence/` | `src/runtime/`, `src/entrypoints/`, `src/ui/` | Preserve a UI-free core and keep event payloads stable. |
| `src/tools/` | Define tool contracts, registration, and execution boundaries. | `src/runtime/permissions`, host utilities | `src/engine/`, extensions | Continue consolidating around capability families instead of one-off tools. |
| `src/persistence/` | Persist sessions, memory, compaction, and todo state. | filesystem, runtime session metadata | `src/runtime/`, `src/ui/`, `src/engine/` | Separate durable stores from derived presentation state. |
| `src/ui/` | Render the Ink experience and transcript/session UX. | `src/runtime/`, engine stream events, persistence resume state | terminal users | Keep rendering and interaction logic separate from policy and storage. |
| `src/extensions/` | Load plugins/extensions and merge extension surfaces safely. | extension contracts, filesystem | `src/runtime/`, `src/tools/`, `src/commands/` | Keep failures isolated and avoid coupling extension loading to core engine flow. |
| `.github/` | Workspace-scoped Copilot customizations such as agents, instructions, and skills that keep repository workflows repeatable. | repository docs, contributor workflows | contributors, repository agents | Keep roles narrow, descriptions discoverable, and assets task-focused. |

## Dependency flow

- `src/entrypoints/` should stay thin and delegate setup to `src/runtime/`.
- `src/runtime/` should orchestrate trust, configuration, providers, extensions, and session state.
- `src/engine/` should remain the execution core and avoid UI formatting concerns.
- `src/tools/` should expose permission-aware capability surfaces to the engine without embedding UI behavior.
- `src/ui/` should consume runtime state and engine events, not own the core execution rules.

## Active cleanup queue

- [ ] Keep the `src/tools/` capability-family consolidation moving toward smaller, clearer public tool surfaces.
- [ ] Tighten the `src/runtime/` vs `src/ui/` boundary so policy stays outside the Ink app.
- [ ] Keep extension loading isolated while clarifying how plugins, skills, and future integrations enter the runtime.
- [ ] Continue documenting hot paths and unstable seams before large refactors.

## Recent structural changes

- Added `.github/skills/pebble-clean-typescript/` for incremental TypeScript cleanup and tree-plan maintenance.
- Added `.github/agents/pebble-documentation.agent.md`, `.github/instructions/pebble-docs.instructions.md`, and `.github/skills/pebble-docs-maintainer/` to support repeatable documentation maintenance.
- Added `docs/DOCS_DIRECTORY.md`, `docs/DOCS_HUB.md`, and `docs/DOCS_MAINTENANCE.md` to turn the Markdown docs into a discoverable suite.
- Added this `docs/CODEBASE_TREE.md` file as the durable map the cleanup skill should keep current.