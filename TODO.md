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
- Core tools exist: Bash, FileRead, FileEdit, Glob, Grep, AskUserQuestion, Todo
- Trust/config/instruction loading exists
- Permission manager exists and is partly wired into engine execution
- Session store and compaction helpers exist
- Interactive and headless runtimes persist session transcripts and support basic resume flows
- Basic Ink REPL exists and can invoke the engine
- UI now exposes trust/session startup chrome, recent-session history, and a tabbed settings panel
- Settings now support provider/model selection plus provider/model list filtering

### What is partial or weak

- REPL has streaming, tool rendering, and permission approval but still lacks full reference UX breadth
- Headless mode exists but is still thin compared to the docs promise
- `/memory` now manages persisted session summaries, but runtime memory injection is still placeholder-heavy
- Persistence is wired for session storage and resume, but memory loading/injection is still placeholder-heavy
- Compaction exists but is not triggered automatically by runtime
- AskUserQuestionTool returns structured prompt data but not a full interactive approval flow
- Permission approval dialogs exist in the REPL; the engine supports async user resolution via `resolvePermission`
- Todo state is in-memory only

### What is still scaffolding/stub territory

- Extension loading now supports local plugin discovery, but MCP/skills and extension tool/provider wiring remain incomplete
- MCP/plugin/skill runtime integration is not implemented
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
- [ ] MCP servers are loaded at runtime
- [ ] MCP loader detects configured server transport/entry data and reports connect/load failures cleanly
- [x] plugins are discovered and loaded at runtime
- [ ] skills are discovered and loaded at runtime
- [ ] extension discovery detects manifest `type` instead of treating every loaded entry as a plugin
- [ ] skill discovery loads local skill entries with typed metadata and instructions ready for runtime injection
- [x] extension-provided tools are merged into the live registry
- [x] extension-provided commands are merged into the live registry
- [ ] extension-provided hooks are merged into the live runtime hook registry
- [ ] extension-provided providers are merged into the live provider/runtime bootstrap path
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
- [ ] runtime loads extensions/hooks/background workflows during boot
- [ ] runtime boot registers extension lifecycle hooks and fires them for session, turn, tool, and error events
- [ ] headless output formatting is extracted behind a typed reporter abstraction shared by text/json/json-stream modes
- [ ] runtime surfaces background/resumable work state during boot instead of treating it as future-only scaffolding
- [x] runtime persists sessions as part of normal CLI execution
- [x] runtime resume flow is implemented end-to-end
- [ ] runtime trust/permission behavior is validated through full interactive flows

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
- [ ] AskUserQuestion provides a full user-response loop rather than just returning prompt data
- [ ] Todo state persists across sessions/process restarts
- [ ] Todo tool is backed by a file-backed store under `.pebble/` rather than process-global memory only
- [ ] risky tools share a reusable approval request/result model instead of custom per-tool prompt wiring
- [ ] pending tool approvals persist with session IDs so interrupted runs can resume or fail them deterministically
- [ ] tool approval UX is surfaced properly in the interactive UI
- [ ] FileWrite tool is implemented (file creation, distinct from FileEdit)
- [ ] ApplyPatch tool is implemented (unified diff patch application)
- [ ] WebFetch tool is implemented (HTTP fetch with pre-approved domains)
- [ ] WebSearch tool is implemented (web search integration)
- [ ] Agent tool is implemented (sub-agent spawning and orchestration)
- [ ] SendMessage tool is implemented (cross-agent messaging)
- [ ] LSP tool is implemented (language server protocol queries)
- [ ] NotebookEdit tool is implemented (Jupyter notebook cell editing)
- [ ] Config tool is implemented (runtime config read/write from agent)
- [ ] EnterPlanMode / ExitPlanMode tools are implemented (plan mode toggling)
- [ ] EnterWorktree / ExitWorktree tools are implemented (worktree management)
- [ ] MCP tools are implemented (MCPTool, McpAuthTool, ListMcpResources, ReadMcpResource)
- [ ] Skill tool is implemented (skill invocation from agent context)
- [ ] Brief tool is implemented (attachment/upload handling)
- [ ] Snip tool is implemented (content snipping/extraction)
- [ ] Sleep tool is implemented (agent delay/wait)
- [ ] REPL tool primitives are implemented (primitive inline evaluation tools)
- [ ] ScheduleCron tools are implemented (CronCreate, CronDelete, CronList)
- [ ] Task management tools are implemented (TaskCreate, TaskGet, TaskList, TaskOutput, TaskStop, TaskUpdate)
- [ ] Team management tools are implemented (TeamCreate, TeamDelete)
- [ ] TodoWrite tool is implemented (structured todo writing, distinct from in-memory Todo tool)
- [ ] ToolSearch tool is implemented (dynamic tool discovery by the agent)
- [ ] RemoteTrigger tool is implemented (remote event/webhook trigger)
- [ ] VerifyPlanExecution tool is implemented (plan execution verification)
- [ ] SyntheticOutput tool is implemented (injected synthetic tool responses)
- [ ] Workflow tool is implemented (workflow orchestration primitives)
- [ ] PowerShell tool is implemented (Windows shell support)
- [ ] Tungsten tool is implemented (live monitoring integration)

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
- [ ] REPL has integration/smoke tests
- [ ] provider failure/fallback paths have tests
- [ ] skill/plugin/MCP discovery has tests for manifest typing, load success, and isolated failure reporting
- [ ] hook firing order has tests across session start, turn boundaries, tool execution, and runtime error paths
- [ ] memory injection and todo persistence have tests covering restart/resume behavior
- [ ] streaming/approval UI renderer selection has tests for typed message and prompt states
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
- [ ] land typed transcript/message renderer primitives before adding more event/message surface area
- [ ] land skill + MCP discovery/loading primitives before expanding extension surface area further
- [ ] land persisted todo + memory injection primitives before deeper resume/background workflows
- [ ] land provider fallback chain primitives together with failure-path tests

## Success criteria for the next milestone

We should not call the product “feature complete” until all of these are true:

- [x] build passes
- [ ] REPL supports real agent interaction cleanly
- [ ] headless mode is reliable and structured
- [ ] session resume works end-to-end
- [ ] extensions load at runtime
- [ ] integration tests cover core flows

## Working rule

When in doubt:

- prefer a smaller, honest backlog over inflated green checkmarks
- mark partial work as partial
- only check things that are wired end-to-end
- keep this document aligned with the actual repo, not the aspirational reference snapshot
