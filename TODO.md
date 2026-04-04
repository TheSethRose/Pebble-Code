# TODO: Pebble Code - Great things start with the smallest pieces.

## Purpose

This document is the **realistic** implementation backlog for **Pebble Code**.

Pebble Code is being built as a terminal-native AI coding agent using **Pi Mono / Pi Coding Agent** as the architectural reference. The reference snapshot shows a **very large and mature product surface**. Our current repo does **not** cover that full breadth yet.

This file is intentionally blunt:

- `[x]` means the code exists and is meaningfully working today
- `[ ]` means missing, partial, stubbed, or not wired end-to-end
- if a thing only exists as an interface, placeholder, or TODO comment, it stays unchecked

## Reality check against the reference snapshot

The reference snapshot includes a much broader system than the current repo, including:

- a much richer terminal UI and message rendering system
- permission dialogs and approval flows
- session resume/history UX
- MCP/plugin/skill loading and management
- background task and worktree workflows
- more commands, more tools, and more runtime surfaces
- deeper testing and operational hardening

Pebble Code currently has a **working core spine**:

- CLI bootstrap and fast paths
- a real engine loop
- a real provider adapter
- core tools
- basic trust/config/persistence helpers
- a minimal REPL shell

But the current repo is still **far from reference breadth**, especially in:

- UI/TUI quality and completeness
- persistence wiring into runtime
- extension loading
- advanced workflows
- end-to-end validation
- integration coverage and operational hardening

## Honest current state

### What is genuinely working today

- CLI fast paths for `--version`, `--help`, `--features`, and `--build-info`
- TypeScript typecheck passes
- Bundled build passes end-to-end
- Unit tests pass
- Core `QueryEngine` multi-turn tool loop exists
- Primary provider makes real OpenAI-compatible API calls
- Core tools now default to a consolidated capability surface: WorkspaceRead, WorkspaceEdit, Shell, UserInteraction, Memory, Web, Notebook, Orchestrate, and Integration, with compatibility aliases for legacy tool names
- Trust/config/instruction loading exists
- Permission manager exists and is partly wired into engine execution
- Session store and compaction helpers exist
- Interactive and headless runtimes persist session transcripts and support basic resume flows
- Basic Ink REPL exists and can invoke the engine
- UI now exposes trust/session startup chrome, recent-session history, and a tabbed settings panel
- Settings now support provider/model selection plus provider/model list filtering

### What is partial or weak

- REPL now has real streaming, richer tool/result rendering, and permission approval, but still lacks full reference UX breadth
- Headless mode exists and supports plain-text / JSON / JSON-stream output through a shared typed reporter, but is still thin compared to the docs promise
- `/memory` now manages persisted session summaries, but runtime memory injection is still placeholder-heavy
- Persistence is wired for session storage and resume, but memory loading/injection is still placeholder-heavy
- AskUserQuestionTool has a working structured request/response path, but still lacks richer multi-question and preview UX like the reference
- Permission approval dialogs exist in the REPL; the engine supports async user resolution via `resolvePermission`, including the streaming interactive path
- Todo state is persisted under `.pebble/`, but it is still much thinner than the reference task/todo/background-work model

### What is still scaffolding/stub territory

- Background/worktree orchestration is still much thinner than the reference product despite boot-time loading/surfacing
- Hooks/worktrees/background sessions are mostly future-facing scaffolding
- Tests do not yet cover the real CLI/REPL/headless/extension flows end-to-end

---

## Build

- [x] Bun + TypeScript project scaffolding exists
- [x] `package.json` scripts exist for typecheck, build, and test
- [x] `scripts/build.ts` exists
- [x] feature flag module exists
- [x] build metadata module exists
- [x] `bun run typecheck` passes
- [x] `bun test` passes
- [x] `bun run build` completes successfully end-to-end
- [x] bundled output in `dist/` is reliable for release use
- [x] build verification covers both normal and failure scenarios

## Commands

- [x] command types exist
- [x] command registry exists
- [x] `/help` works
- [x] `/clear` works
- [x] `/exit` works
- [x] `/config` works
- [x] `/login` works
- [x] `/provider` works
- [x] `/model` works
- [x] command aliases work
- [x] command discovery through `/help` works
- [x] `/resume` actually resumes a stored session
- [x] `/memory` is backed by a real memory system
- [x] `/review` performs a real review flow
- [x] command loading merges extension-provided commands at runtime
- [x] command filtering by runtime mode/trust is implemented cleanly

## Engine

- [x] canonical message types exist
- [x] result envelope types exist
- [x] stream event protocol types exist
- [x] `QueryEngine` supports multi-turn recursion
- [x] `QueryEngine` supports tool-call -> tool-result -> continuation cycles
- [x] `QueryEngine` supports abort/max-turn/error terminal states
- [x] engine emits stream events during execution
- [x] engine integrates with permission checks before risky tool use
- [x] query wrappers exist in `src/engine/query.ts`
- [x] headless/runtime use the full SDK/event contract promised in docs
- [x] engine recovery/compaction behavior is wired into long sessions
- [x] engine behavior is covered by integration tests instead of just helper/unit tests

## Entrypoints

- [x] CLI entrypoint exists
- [x] fast-path routing exists for trivial commands
- [x] runtime option parsing exists for headless/model/provider/cwd/resume
- [x] runtime boot is dynamically loaded after fast-path checks
- [x] interactive path starts the runtime
- [x] headless path starts the runtime
- [x] `--resume` is actually wired into a resume flow
- [x] SDK-specific entrypoint/runtime surface exists beyond the basic CLI path
- [x] entrypoint behavior is covered by smoke tests

## Extensions

- [x] extension contracts/interfaces exist
- [x] loader API shape exists
- [x] extension failure reporting shape exists
- [x] extension loading is actually implemented
- [x] MCP servers are loaded at runtime
- [x] MCP loader detects configured server transport/entry data and reports connect/load failures cleanly
- [x] plugins are discovered and loaded at runtime
- [x] skills are discovered and loaded at runtime
- [x] extension discovery detects manifest `type` instead of treating every loaded entry as a plugin
- [x] skill discovery loads local skill entries with typed metadata and instructions ready for runtime injection
- [x] extension-provided tools are merged into the live registry
- [x] extension-provided commands are merged into the live registry
- [x] extension-provided hooks are merged into the live runtime hook registry
- [x] extension-provided providers are merged into the live provider/runtime bootstrap path
- [x] extension isolation is proven by tests

## Persistence

- [x] session transcript types exist
- [x] file-backed session store exists
- [x] create/load/list/fork/update status operations exist
- [x] corrupt session files are handled defensively during load/list
- [x] compaction helper code exists
- [x] token accounting helper code exists
- [x] cost tracking helper code exists
- [x] runtime writes active conversations to session storage during real use
- [x] runtime can continue the most recent session
- [x] runtime can resume a session by ID
- [ ] runtime exposes memory loading/injection beyond placeholders
- [ ] stale session memory can be rebuilt on demand before a resume or new turn starts
- [ ] runtime injects persisted session memory into conversation/system context before the next query
- [ ] headless run metadata/report summaries persist separately from raw transcript messages for later inspection
- [x] compaction is automatically triggered in long conversations

## Providers

- [x] provider abstraction exists
- [x] provider capabilities are modeled
- [x] primary provider adapter exists
- [x] primary provider can make real OpenAI-compatible calls
- [x] primary provider supports non-streaming responses
- [x] primary provider supports streaming text responses
- [x] provider configuration reads from environment variables
- [x] provider auth/setup UX exists in the product
- [ ] provider fallback behavior is implemented and tested
- [ ] multi-provider support exists beyond the primary adapter
- [ ] provider settings can express a primary + ordered fallback chain with per-provider model overrides
- [ ] provider resolution records which provider/model actually answered for debug and headless reporting
- [ ] provider failure scenarios are covered by tests

## Runtime

- [x] runtime boot path exists
- [x] config loading exists
- [x] trust detection exists
- [x] repository instruction loading exists
- [x] permission manager exists
- [x] headless runtime path exists
- [x] interactive runtime path exists
- [x] runtime loads extensions/hooks/background workflows during boot
- [x] runtime boot registers extension lifecycle hooks and fires them for session, turn, tool, and error events
- [x] headless output formatting is extracted behind a typed reporter abstraction shared by text/json/json-stream modes
- [x] runtime surfaces background/resumable work state during boot instead of treating it as future-only scaffolding
- [x] runtime persists sessions as part of normal CLI execution
- [x] runtime resume flow is implemented end-to-end
- [x] runtime trust/permission behavior is validated through full interactive flows

## Tools

- [x] tool contract exists
- [x] tool registry exists
- [x] tool orchestration builds an MVP tool set
- [x] Bash tool is implemented
- [x] FileRead tool is implemented
- [x] FileEdit tool is implemented
- [x] Glob tool is implemented
- [x] Grep tool is implemented
- [x] AskUserQuestion tool exists
- [x] Todo tool exists
- [x] risky tool approval detection exists for Bash/FileEdit
- [x] AskUserQuestion provides a full user-response loop rather than just returning prompt data
- [x] Todo state persists across sessions/process restarts
- [x] Todo tool is backed by a file-backed store under `.pebble/` rather than process-global memory only
- [x] tool surface is consolidated around a small number of capability tools instead of proliferating one-off tools for every niche workflow
- [x] risky tools share a reusable approval request/result model instead of custom per-tool prompt wiring
- [x] pending tool approvals persist with session IDs so interrupted runs can resume or fail them deterministically
- [x] tool approval UX is surfaced properly in the interactive UI
- [x] FileWrite tool is implemented (file creation, distinct from FileEdit)
- [x] ApplyPatch tool is implemented (unified diff patch application)
- [x] tool registry supports richer metadata (capability categories, aliases, qualified source names, model-specific definitions, and compatibility mappings from legacy/reference tool names)
- [x] tool execution emits richer structured metadata (tool call IDs, durations, success/failure, resumable task references, and prompt/debug summaries) for UI, tracing, and headless reporting
- [x] `WorkspaceRead` tool is implemented as the consolidated read/inspect surface for directory listing, file reading, glob/grep/project-structure queries, diagnostics/git/test/LSP inspection, image/content summarisation, and dynamic tool discovery
- [x] `WorkspaceEdit` tool is implemented as the consolidated local mutation surface for create-directory, create-file, edit/replace, apply-patch, config mutation, brief/snip extraction, and other deterministic workspace edits
- [x] `Shell` tool is implemented as the consolidated execution surface for Bash/PowerShell commands, REPL-style inline evaluation, and controlled wait/poll behaviors
- [x] `UserInteraction` tool is implemented as the consolidated ask/approve surface for clarifying questions, confirmation prompts, and reusable permission request/result flows
- [x] `Memory` tool is implemented as the consolidated persistence surface for memories, todos/todo-write, lightweight session state, and related file-backed agent notes
- [x] `Web` tool is implemented as the consolidated remote-content surface for web fetch, web search, external repo/doc retrieval, batched URLs, ranked snippets, and domain controls
- [x] `Notebook` tool is implemented as the consolidated notebook workflow surface (`CreateNewJupyterNotebook`, `NotebookSummary`, `RunNotebookCell`, `ReadCellOutput`, `EditNotebook`)
- [x] `Orchestrate` tool is implemented as the consolidated coordination surface for agent/subagent spawning, search/execution wrappers, cross-agent messaging, tasks, cron, teams, workflows, verification, plan/worktree transitions, and remote triggers
- [x] `Integration` tool is implemented as the consolidated external-system surface for MCP auth/resources/tools, skills, Tungsten/live-monitoring hooks, and other pluggable runtime integrations
- [x] compatibility aliases exist so legacy/reference concepts still work through the consolidated set (for example: `ListDirectory` → `WorkspaceRead`, `WebFetch`/`WebSearch` → `Web`, `Agent`/`SearchSubagent`/`ExecutionSubagent` → `Orchestrate`)
- [x] low-level concrete tool implementations are hidden behind capability tools unless a separate permission boundary or execution model truly requires user-visible separation

## UI

- [x] Ink app shell exists
- [x] prompt input exists
- [x] basic transcript rendering exists
- [x] slash commands work inside the REPL
- [x] basic engine invocation from the REPL exists
- [x] basic tool activity messages are shown
- [x] basic processing/error states are shown
- [x] UI has a dedicated prompt input component system
- [x] UI has a real streaming renderer instead of a minimal flat list
- [x] transcript rendering is split into typed components for assistant text, tool call, tool result, progress, approval, and error states
- [x] streaming output updates existing message rows incrementally instead of appending only flat final text
- [x] UI has permission approval dialogs / prompts
- [x] UI has a reusable approval prompt component with allow/deny/session/persist choices for risky actions
- [x] UI has trust/onboarding/startup surfaces
- [x] UI has a tabbed settings panel for config/provider/model/API key management
- [x] UI settings support searchable/filterable provider and model selection
- [x] UI has session resume/history UI
- [x] UI has richer message rendering for tools, progress, and errors
- [ ] tool messages can expand to show structured args/results and headless/report metadata when present
- [ ] UI quality is anywhere close to the reference snapshot breadth

## Tests

- [x] test suite exists
- [x] commands have unit tests
- [x] persistence helpers have unit tests
- [x] trust/permission helpers have unit tests
- [x] current tests pass
- [x] build success is covered by tests or CI-like verification
- [x] headless mode has end-to-end tests
- [x] REPL has integration/smoke tests
- [ ] provider failure/fallback paths have tests
- [x] skill/plugin/MCP discovery has tests for manifest typing, load success, and isolated failure reporting
- [ ] hook firing order has tests across session start, turn boundaries, tool execution, and runtime error paths
- [ ] memory injection and todo persistence have tests covering restart/resume behavior
- [x] streaming/approval UI renderer selection has tests for typed message and prompt states
- [x] extension loading/isolation has tests
- [ ] engine/tool flows have end-to-end tests

---

## Immediate priorities

These are the next honest priority slices if we want the repo to materially close the gap with the reference snapshot:

1. **Add real integration and smoke coverage** for CLI, headless, REPL, and resume flows
2. **Make the REPL meaningfully usable** with better streaming, approvals, and richer message rendering
3. **Turn extensions from contracts into runtime behavior**
4. **Wire automatic compaction and real memory loading/injection**
5. **Expand provider resilience** with fallback behavior, multi-provider support, and failure-path tests

Concrete reusable slices worth landing inside those priorities:

- [ ] land shared approval flow primitives before expanding risky-tool UX further
- [ ] land the capability-tool boundaries and alias strategy before adding any new reference-style tool names
- [ ] land registry metadata + tool search primitives before adding many more niche tools
- [ ] land directory/diagnostic helper tools before exotic background-agent workflows
- [ ] land notebook tools as a coherent cluster instead of a one-off edit-only primitive
- [ ] land typed transcript/message renderer primitives before adding more event/message surface area
- [ ] land skill + MCP discovery/loading primitives before expanding extension surface area further
- [ ] land search/execution subagents as thin wrappers once generic agent/task plumbing exists
- [ ] land persisted todo + memory injection primitives before deeper resume/background workflows
- [ ] land provider fallback chain primitives together with failure-path tests

## Success criteria for the next milestone

We should not call the product “feature complete” until all of these are true:

- [x] build passes
- [ ] REPL supports real agent interaction cleanly
- [ ] headless mode is reliable and structured
- [ ] session resume works end-to-end
- [x] extensions load at runtime
- [ ] integration tests cover core flows

## Working rule

When in doubt:

- prefer a smaller, honest backlog over inflated green checkmarks
- mark partial work as partial
- only check things that are wired end-to-end
- keep this document aligned with the actual repo, not the aspirational reference snapshot
