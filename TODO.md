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
- build health

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
- Basic Ink REPL exists and can invoke the engine
- UI now exposes trust/session startup chrome and recent-session history

### What is partial or weak

- REPL is minimal and lacks rich terminal UX
- Headless mode exists but is still thin compared to the docs promise
- `/memory` is still a thin session-backed status view, not a full memory system
- Persistence exists but is not fully wired into runtime flow
- Compaction exists but is not triggered automatically by runtime
- AskUserQuestionTool returns structured prompt data but not a full interactive approval flow
- Todo state is in-memory only

### What is still scaffolding/stub territory

- Extension loading (`src/extensions/loaders.ts`) is still stubbed
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
- [x] `/model` works
- [x] command aliases work
- [x] command discovery through `/help` works
- [x] `/resume` actually resumes a stored session
- [ ] `/memory` is backed by a real memory system
- [x] `/review` performs a real review flow
- [ ] command loading merges extension-provided commands at runtime
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
- [ ] headless/runtime use the full SDK/event contract promised in docs
- [ ] engine recovery/compaction behavior is wired into long sessions
- [ ] engine behavior is covered by integration tests instead of just helper/unit tests

## Entrypoints

- [x] CLI entrypoint exists
- [x] fast-path routing exists for trivial commands
- [x] runtime option parsing exists for headless/model/provider/cwd/resume
- [x] runtime boot is dynamically loaded after fast-path checks
- [x] interactive path starts the runtime
- [x] headless path starts the runtime
- [ ] `--resume` is actually wired into a resume flow
- [ ] SDK-specific entrypoint/runtime surface exists beyond the basic CLI path
- [ ] entrypoint behavior is covered by smoke tests

## Extensions

- [x] extension contracts/interfaces exist
- [x] loader API shape exists
- [x] extension failure reporting shape exists
- [ ] extension loading is actually implemented
- [ ] MCP servers are loaded at runtime
- [ ] plugins are discovered and loaded at runtime
- [ ] skills are discovered and loaded at runtime
- [ ] extension-provided tools are merged into the live registry
- [ ] extension-provided commands are merged into the live registry
- [ ] extension isolation is proven by tests

## Persistence

- [x] session transcript types exist
- [x] file-backed session store exists
- [x] create/load/list/fork/update status operations exist
- [x] corrupt session files are handled defensively during load/list
- [x] compaction helper code exists
- [x] token accounting helper code exists
- [x] cost tracking helper code exists
- [ ] runtime writes active conversations to session storage during real use
- [ ] runtime can continue the most recent session
- [ ] runtime can resume a session by ID
- [ ] runtime exposes memory loading/injection beyond placeholders
- [ ] compaction is automatically triggered in long conversations

## Providers

- [x] provider abstraction exists
- [x] provider capabilities are modeled
- [x] primary provider adapter exists
- [x] primary provider can make real OpenAI-compatible calls
- [x] primary provider supports non-streaming responses
- [x] primary provider supports streaming text responses
- [x] provider configuration reads from environment variables
- [ ] provider auth/setup UX exists in the product
- [ ] provider fallback behavior is implemented and tested
- [ ] multi-provider support exists beyond the primary adapter
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
- [ ] runtime persists sessions as part of normal CLI execution
- [ ] runtime resume flow is implemented end-to-end
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
- [ ] broader tool surface from the reference snapshot is implemented
- [ ] tool approval UX is surfaced properly in the interactive UI

## UI

- [x] Ink app shell exists
- [x] prompt input exists
- [x] basic transcript rendering exists
- [x] slash commands work inside the REPL
- [x] basic engine invocation from the REPL exists
- [x] basic tool activity messages are shown
- [x] basic processing/error states are shown
- [ ] UI has a dedicated prompt input component system
- [ ] UI has a real streaming renderer instead of a minimal flat list
- [ ] UI has permission approval dialogs / prompts
- [x] UI has trust/onboarding/startup surfaces
- [x] UI has session resume/history UI
- [ ] UI has richer message rendering for tools, progress, and errors
- [ ] UI quality is anywhere close to the reference snapshot breadth

## Tests

- [x] test suite exists
- [x] commands have unit tests
- [x] persistence helpers have unit tests
- [x] trust/permission helpers have unit tests
- [x] current tests pass
- [ ] build success is covered by tests or CI-like verification
- [ ] headless mode has end-to-end tests
- [ ] REPL has integration/smoke tests
- [ ] provider failure/fallback paths have tests
- [ ] extension loading/isolation has tests
- [ ] engine/tool flows have end-to-end tests

---

## Immediate priorities

These are the next honest priority slices if we want the repo to materially close the gap with the reference snapshot:

1. **Fix the build** so `bun run build` works again
2. **Finish runtime wiring** for persistence and resume
3. **Make the REPL meaningfully usable** with better streaming, approvals, and session UX
4. **Turn extensions from contracts into runtime behavior**
5. **Add real integration tests** for CLI/headless/engine flows

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
