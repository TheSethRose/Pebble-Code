# TODO: Pebble Code - Great things start with the smallest pieces.

## Purpose

This is the implementation roadmap for building **Pebble Code** — a terminal-native AI coding agent.

The implementation uses **Pi Mono / Pi Coding Agent** as the architectural reference and implementation guide. Pi Mono provides proven patterns for the agent loop, tool contracts, permission model, persistence layer, and extension system.

It is ordered by **dependency and risk**, not by snapshot file count.

Important execution rule:

- prefer normal repository files and scripts for scaffolding, testing, and validation
- avoid giant inline shell one-liners or long terminal eval blobs
- build thin vertical slices and verify them before widening scope

## Delivery strategy

### Guiding principles

1. **Build the spine first** — bootstrap, init, engine, REPL, headless.
2. **Separate product modules** — commands, tools, providers, persistence, UI, extensions.
3. **Defer optional experiments** until the core loop is stable.
4. **Design for resumability** from the start.
5. **Treat feature flags as taxonomy**, not a parity checklist.
6. **Keep trust and permissions first-class**.
7. **Define provider and extension interfaces early**, even if their full implementation lands later.

## Recommended fresh project shape

A clean recreation can use a structure like this:

- `src/entrypoints/`
  - CLI bootstrap
  - headless entry
  - optional SDK entry
- `src/runtime/`
  - init
  - config
  - trust
  - settings
  - session boot
- `src/engine/`
  - `query.ts`
  - `QueryEngine.ts`
  - streaming/result model
  - retries and continuation
- `src/commands/`
  - built-ins
  - registry
  - loaders
- `src/tools/`
  - tool contract
  - built-ins
  - orchestration
  - permission enforcement
- `src/providers/`
  - provider abstraction
  - adapters
  - auth/config
- `src/persistence/`
  - transcripts
  - resume
  - memory
  - compaction
- `src/extensions/`
  - skills
  - plugins
  - MCP
- `src/ui/`
  - Ink REPL
  - dialogs
  - prompt/input/output surfaces
- `src/build/`
  - feature flags
  - build metadata
  - variant definitions

## Snapshot mapping to fresh modules

| Snapshot evidence | Fresh implementation target |
|---|---|
| `src/entrypoints/cli.tsx` | `src/entrypoints/cli.tsx` or equivalent bootstrap |
| `src/main.tsx` | `src/runtime/main.tsx` / `src/runtime/run.ts` |
| `src/query.ts` | `src/engine/query.ts` |
| `src/QueryEngine.ts` | `src/engine/QueryEngine.ts` |
| `src/commands.ts` | `src/commands/registry.ts` |
| `src/tools.ts` | `src/tools/registry.ts` |
| `scripts/build.ts` | `scripts/build.ts` + feature metadata |
| transcript/memory code | `src/persistence/*` |
| MCP/plugin/skill loading | `src/extensions/*` |

## Mandatory product surfaces to classify up front

These must be labeled as **MVP**, **post-MVP**, or **intentionally dropped** during planning:

- [x] interactive REPL (MVP)
- [x] headless/print mode (MVP)
- [x] SDK/streaming protocol (MVP)
- [x] resume / continue / fork-session semantics (MVP)
- [x] config layering and settings sources (MVP)
- [x] repository instruction loading (`CLAUDE.md`-style behavior) (MVP)
- [x] setup/session-start hooks (Post-MVP) — interfaces defined in `src/runtime/hooks.ts`
- [x] worktree flows (Post-MVP) — implementation in `src/runtime/worktrees.ts`
- [x] background-session utilities (Post-MVP) — implementation in `src/runtime/backgroundSessions.ts`
- [x] bridge/remote-control flows (Dropped)
- [x] daemon/worker flows (Dropped)
- [x] SSH/direct-connect/deep-link style entry paths (Dropped)
- [x] environment-runner / self-hosted-runner style flows (Dropped)

---

## Phase 0 — Frame the product before writing code

### Goals

- freeze MVP scope
- classify deferred/experimental capabilities
- avoid snapshot-parity rabbit holes

### Tasks

- [x] Write/approve ADR: recreate product capabilities, not file layout
- [x] Define MVP provider strategy
- [x] Define extension strategy for MCP/plugins/skills
- [x] Define telemetry/privacy policy
- [x] Define headless/SDK event protocol
- [x] Define resume semantics (`continue`, `resume`, `fork`, point-in-time restore)
- [x] Define settings layering and repository-instruction behavior
- [x] Define feature flag taxonomy:
  - [x] core
  - [x] beta
  - [x] runtime-optional
  - [x] deferred
  - [x] dropped

### Acceptance check

- [x] team can name what is in MVP and what is explicitly deferred
- [x] no missing/broken snapshot subsystem is accidentally treated as mandatory
- [x] all major operating modes are explicitly classified as MVP, later, or dropped

---

## Phase 1 — Build the executable skeleton

### Goals

Create a bootable CLI with fast routing and a stable build pipeline.

### Tasks

- [x] Initialize Bun + TypeScript workspace
- [x] Add binary entry configuration in `package.json`
- [x] Create `src/entrypoints/cli.tsx`
- [x] Implement fast-path routing for:
  - [x] `--version`
  - [x] `--help`
  - [x] simple utility paths
  - [x] fallback to full runtime
- [x] Create `src/runtime/main.ts` or `src/main.tsx`
- [x] Add compile/build script similar to `scripts/build.ts`
- [x] Add compile-time macro injection for version/build metadata
- [x] Add first feature-flag injection layer
- [x] Add provider abstraction stub now, even if only one provider ships first
- [x] Reserve extension registry interfaces for MCP/plugins/skills now

### Suggested files

- `src/entrypoints/cli.tsx`
- `src/runtime/main.ts`
- `scripts/build.ts`
- `src/build/featureFlags.ts`
- `src/build/buildInfo.ts`
- `src/providers/types.ts`
- `src/extensions/contracts.ts`

### Acceptance check

- [x] `--version` works without full runtime boot
- [x] interactive runtime starts
- [x] headless runtime starts
- [x] standalone binary build succeeds
- [x] provider and extension interfaces exist without forcing full implementation

---

## Phase 2 — Implement the message model and core engine ✅

### Goals

Build the heart of the product: a reusable agent loop that can stream, recurse, and terminate correctly.

### Tasks

- [x] Define canonical message types:
  - [x] user
  - [x] assistant
  - [x] tool result
  - [x] progress
  - [x] system/control messages
  - [x] attachments if needed
- [x] Implement `src/engine/query.ts`
- [x] Implement `src/engine/QueryEngine.ts`
- [x] Support streaming response events
- [x] Support tool-use → tool-result → continuation cycles
- [x] Support recursive turns with bounded max turns
- [x] Support success/error/result terminal states
- [x] Support abort/interrupt handling
- [x] Support structured headless result envelopes
- [x] Define and emit a stable stream event protocol for headless/SDK callers
- [x] Model result envelope types for:
  - [x] init/session metadata
  - [x] user replay
  - [x] stream events
  - [x] retry events
  - [x] progress events
  - [x] permission denials
  - [x] result terminal states

### Suggested files

- `src/engine/query.ts`
- `src/engine/QueryEngine.ts`
- `src/engine/types.ts`
- `src/engine/results.ts`
- `src/engine/transitions.ts`
- `src/engine/sdkProtocol.ts`

### Acceptance check

- [x] engine can process a multi-turn prompt with mocked tool calls
- [x] engine can stop on success, error, max-turn, or interrupt
- [x] headless caller receives deterministic result objects
- [x] stream consumers can parse a stable event contract

---

## Phase 3 — Implement the tool contract and MVP tools ✅

### Goals

Build a permission-aware tool system with enough primitives to do real coding work.

### Tasks

- [x] Define tool interface/schema
- [x] Implement tool registry assembly
- [x] Implement tool filtering by runtime state and permissions
- [x] Implement tool orchestration and result normalization
- [x] Build MVP tools:
  - [x] Bash
  - [x] FileRead
  - [x] FileEdit / ApplyPatch / FileWrite
  - [x] Glob
  - [x] Grep
  - [x] AskUserQuestion
  - [x] Todo / task tracker
- [x] Optional for MVP+:
  - [x] WebFetch
  - [x] WebSearch
  - [x] NotebookEdit

### Suggested files

- `src/tools/Tool.ts`
- `src/tools/registry.ts`
- `src/tools/orchestration.ts`
- `src/tools/BashTool/*`
- `src/tools/FileReadTool/*`
- `src/tools/FileEditTool/*`
- `src/tools/ApplyPatchTool/*`
- `src/tools/GrepTool/*`
- `src/tools/GlobTool/*`
- `src/tools/AskUserQuestionTool/*`
- `src/tools/TodoTool/*`

### Acceptance check

- [x] agent can inspect and modify files end-to-end
- [x] denied tools are blocked cleanly
- [x] tool failures do not corrupt the session

---

## Phase 4 — Implement trust and permissions ✅

### Goals

Make trust and permission gating part of the product, not a late bolt-on.

### Tasks

- [x] Define permission modes
- [x] Define trust model for working directory/project
- [x] Implement permission prompts and allow/deny state
- [x] Implement persistent permission context
- [x] Implement safe defaults for risky tools
- [x] Implement headless behavior for permission denial reporting
- [x] Implement repository trust gating for project-scoped settings/instructions/hooks
- [x] Implement minimal/bare mode that deliberately bypasses most dynamic loading

### Suggested files

- `src/runtime/trust.ts`
- `src/runtime/permissions.ts`
- `src/tools/permissionContext.ts`
- `src/ui/PermissionDialog.tsx`
- `src/runtime/projectContext.ts`
- `src/runtime/hooks.ts`
- `src/runtime/bareMode.ts`

### Acceptance check

- [x] interactive mode prompts when appropriate
- [x] headless mode reports denials structurally
- [x] unsafe actions do not bypass the declared mode
- [x] untrusted repositories cannot silently activate project-scoped behavior

---

## Phase 5 — Build the command system ✅

### Goals

Create a slash-command layer distinct from tools.

### Tasks

- [x] Define command types:
  - [x] local
  - [x] prompt-generating
  - [x] UI-only/local-jsx equivalent
- [x] Create command registry loader
- [x] Create runtime command filtering
- [x] Implement MVP commands:
  - [x] `/help`
  - [x] `/clear`
  - [x] `/exit`
  - [x] `/model`
  - [x] `/config`
  - [x] `/resume`
  - [x] `/memory`
  - [x] `/permissions`
  - [x] `/plan` or equivalent
  - [x] `/review` or equivalent
- [x] Add compatibility for command aliases where desired

### Suggested files

- `src/commands/types.ts`
- `src/commands/registry.ts`
- `src/commands/loaders.ts`
- `src/commands/help.ts`
- `src/commands/resume.ts`
- `src/commands/model.ts`

### Acceptance check

- [x] slash commands are discoverable in REPL
- [x] prompt-style and local commands can coexist cleanly
- [x] command loading can later merge extension-provided commands

---

## Phase 6 — Build the interactive REPL UX ✅

### Goals

Ship a usable terminal interface around the engine.

### Tasks

- [x] Create Ink app shell
- [x] Create prompt input component
- [x] Create streaming output renderer
- [x] Create tool approval / progress rendering
- [x] Create startup/onboarding/trust surfaces
- [x] Create session resume/history UI
- [x] Create graceful interrupt and abort UX

### Suggested files

- `src/ui/App.tsx`
- `src/ui/PromptInput.tsx`
- `src/ui/MessageStream.tsx`
- `src/ui/StartupScreen.tsx`
- `src/ui/ResumePicker.tsx`

### Acceptance check

- [x] user can complete a real coding task in REPL
- [x] streaming output is readable
- [x] tool activity is understandable
- [x] aborting does not leave the UI broken

---

## Phase 7 — Build persistence, resume, and memory ✅

### Goals

Make conversations durable and resumable.

### Tasks

- [x] Define transcript format
- [x] Implement append-safe transcript recording
- [x] Implement session lookup/resume flow
- [x] Implement continue-most-recent behavior
- [x] Implement explicit resume-by-id behavior
- [x] Implement fork-session behavior
- [x] Decide whether point-in-time resume and rewind-files semantics are MVP or later
- [x] Handle partial/corrupt sessions gracefully
- [x] Implement memory loading policy
- [x] Implement memory attachment or injection path

### Suggested files

- `src/persistence/transcripts.ts`
- `src/persistence/sessionStore.ts`
- `src/persistence/resume.ts`
- `src/persistence/memory.ts`
- `src/persistence/sessionForks.ts`

### Acceptance check

- [x] interrupted sessions can usually be resumed
- [x] session files survive normal agent usage
- [x] memory does not duplicate endlessly across turns
- [x] users can continue, resume, and fork sessions predictably

---

## Phase 8 — Implement compaction, token, and cost management ✅

### Goals

Keep long sessions usable without losing the task thread.

### Tasks

- [x] Add token accounting hooks
- [x] Add cost accounting hooks
- [x] Add compact boundary/message model
- [x] Implement proactive or reactive compaction strategy
- [x] Implement long-context recovery path
- [x] Preserve resume semantics across compaction

### Suggested files

- `src/persistence/compaction.ts`
- `src/persistence/tokenBudget.ts`
- `src/persistence/costTracker.ts`
- `src/engine/recovery.ts`

### Acceptance check

- [x] long sessions stay functional
- [x] compaction does not break resume or tool continuity
- [x] token/cost summaries are available to the user

---

## Phase 9 — Complete provider implementations and auth ✅

### Goals

Complete the provider layer reserved earlier and support one provider well before widening.

### Tasks

- [x] Define provider interface
- [x] Define capability registry per provider/model
- [x] Implement primary provider adapter
- [x] Implement auth/config flow
- [x] Implement model selection and fallback rules
- [x] Add secondary provider adapter only after the first is stable

### Suggested files

- `src/providers/types.ts`
- `src/providers/registry.ts`
- `src/providers/primary/*`
- `src/providers/auth/*`
- `src/providers/capabilities.ts`

### Acceptance check

- [x] user can configure and use one provider end-to-end
- [x] model selection works in interactive and headless mode
- [x] fallback behavior is bounded and visible

---

## Phase 10 — Add MCP, plugins, and skills ✅

### Goals

Add extension surfaces after the core product is stable.

### Tasks

- [x] Implement MCP config loading
- [x] Implement MCP tool/resource registration
- [x] Implement plugin discovery and loading
- [x] Implement bundled skill loading
- [x] Implement dynamic skill loading
- [x] Isolate extension failures from core runtime
- [x] Merge extension commands/tools into registries cleanly

### Suggested files

- `src/extensions/mcp/*`
- `src/extensions/plugins/*`
- `src/extensions/skills/*`
- `src/extensions/loaders.ts`

### Acceptance check

- [x] MCP can contribute capabilities without core edits
- [x] skills/plugins can be loaded and filtered at runtime
- [x] bad extensions fail isolated

---

## Phase 11 — Add advanced workflows selectively ✅

### Goals

Promote only the advanced capabilities that are worth the maintenance burden.

### Candidates

- [x] worktree flows
- [x] background task model
- [x] plan/verify loops
- [x] remote/bridge workflows
- [x] higher-order agent orchestration

### Important rule

Do **not** port advanced snapshot surfaces by default just because they exist.
Each must justify itself in terms of user value, complexity, and maintenance cost.

### Acceptance check

- [x] any promoted advanced workflow is documented, testable, and non-fragile

---

## Phase 12 — Feature flag taxonomy and build variants ✅

### Goals

Recreate the product’s feature-variant strategy without blindly copying all historical flags.

### Tasks

- [x] Define stable/default feature set
- [x] Define beta feature set
- [x] Define experimental/full build set
- [x] Mark intentionally dropped flags
- [x] Mark runtime-optional capabilities separately from compile-time flags
- [x] Add feature manifest documentation

### Suggested files

- `src/build/featureManifest.ts`
- `docs/FEATURES_RECREATED.md`
- `scripts/build.ts`

### Acceptance check

- [x] stable build works
- [x] experimental build works
- [x] unsupported flags cannot silently half-enable broken subsystems

---

## Phase 13 — Validation and hardening ✅

### Goals

Prove the recreation is trustworthy.

### Test categories

- [x] startup smoke tests
- [x] interactive REPL smoke tests
- [x] headless deterministic tests
- [x] transcript persistence tests
- [x] resume tests
- [x] permission/trust tests
- [x] compaction/recovery tests
- [x] provider failure/fallback tests
- [x] extension isolation tests

### Acceptance check

- [x] failures are localized and diagnosable
- [x] core flows remain intact when optional surfaces are disabled

---

## Explicit MVP stop line

Claude Code should consider the MVP complete when all of these are true:

- [x] CLI bootstrap is fast and stable
- [x] REPL works
- [x] headless mode works
- [x] core engine supports multi-turn tool use
- [x] core tools support real coding tasks
- [x] trust + permission model is functional
- [x] transcript persistence + resume work
- [x] one provider is production-ready
- [x] build variants exist
- [x] privacy-first operation is preserved

---

## Explicitly deferred unless promoted

These areas are present in the snapshot but should **not** automatically block the fresh build:

- [x] full assistant/KAIROS stack — intentionally excluded, not core to terminal agent
- [x] proactive/dream systems — intentionally excluded, experimental feature
- [x] every broken feature-flag reconstruction in `FEATURES.md` — intentionally excluded, using clean taxonomy
- [x] deep bridge/daemon/coordinator parity — intentionally excluded, dropped from scope
- [x] exact command-count parity — intentionally excluded, not a product requirement
- [x] Anthropic-internal package restoration — intentionally excluded, not relevant to fresh build
- [x] compile-safe-but-runtime-fragile experiments without clear product value — intentionally excluded

---

## Final instruction

Build this in vertical slices:

1. boot
2. init
3. engine
4. tools
5. REPL/headless
6. persistence
7. provider
8. extensibility
9. advanced workflows

When in doubt:

- preserve product behavior
- simplify implementation
- keep privacy and trust explicit
- prefer a smaller coherent MVP over a sprawling fragile parity clone
