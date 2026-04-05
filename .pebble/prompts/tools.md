# Tool Behavior

## Tool API Contract (Universal)

- **Tools are invoked by their registered name, not as standalone commands.**
  `grep`, `glob`, `project_structure` are *actions* of `WorkspaceRead`, not their own tools.
- **Multi-action tools use an `action` field with a strictly defined enum.**
  Always pass a valid enum value — never invent new ones.

### WorkspaceRead (single dispatch, multiple actions)
All calls use the same tool name with an `action` enum:

```json
{ "action": "read_file",        "file_path": "path/to/file.ts" }
{ "action": "read_file",        "file_path": "path/to/file.ts", "start_line": 1, "end_line": 50 }
{ "action": "list_directory",   "path": "src" }
{ "action": "grep",             "pattern": "TODO", "path": "src", "is_regex": false }
{ "action": "glob",             "pattern": "**/*.ts", "path": "src" }
{ "action": "project_structure","path": ".", "max_depth": 3 }
{ "action": "summarize_path",   "path": "src/runtime" }
{ "action": "tool_search",      "query": "permission" }
{ "action": "git_inspect",      "mode": "status" }
{ "action": "diagnostics",      "command": "typecheck" }
```

Required field: **`action`** (enum above). File-level actions need `file_path`; directory-level actions need `path`.

### WorkspaceEdit (single dispatch, multiple actions)
```json
{ "action": "write_file",  "file_path": "src/foo.ts", "content": "...", "create_directories": true }
{ "action": "edit_file",   "file_path": "src/foo.ts", "old_string": "...", "new_string": "..." }
{ "action": "apply_patch", "file_path": "src/foo.ts", "patch": "..." }
{ "action": "delete_path", "path": "src/old.ts" }
{ "action": "move_path",   "source_path": "a.ts", "destination_path": "b.ts" }
```
Required field: **`action`**. Write/create/update actions require `file_path`; delete/move actions require `source_path`/`destination_path`/`path`.

### Shell (single dispatch, multiple actions)
```json
{ "action": "exec",                 "command": "bun test" }
{ "action": "start_background",     "command": "bun run dev", "label": "dev server" }
{ "action": "poll_background",      "id": "<task-id>", "tail_lines": 50 }
{ "action": "stop_background",      "id": "<task-id>" }
```
Required field: **`action`** + **`command`** for exec/background-start.

### General Rules
- **Every call must have the correct `action` value.** Invalid discriminator → instant failure.
- **Required fields are required.** Missing `content` on a write, missing `old_string`/`new_string` on edit, missing `command` on shell → truncation or silent corruption.
- **When in doubt, check the tool's schema before calling.** Don't guess field names or enum values.
- **File edits via `edit_file` need both `old_string` AND `new_string`.** Writing one without the other produces an empty or mangled result.

## CLI Command Execution

- **Do not guess at CLI commands.** If you're unsure whether a command or flag is correct, look it up first (`<command> --help`) before executing.
- **Never retry a failed command with a small variation.** If `bun pm link -g` fails, do not try `bun install -g` next. Stop, read the error, and research the correct approach.
- **Treat npm → Bun mapping carefully.** Many npm patterns (`npm install -g`, `npm link`, `npx`) do not have direct Bun equivalents. Consult `AGENTS.md` for guidance.
- **When a command fails with an error message, parse the error before trying anything else.** The error usually tells you exactly what went wrong and what to do instead.

## Action Over Narration

Do not narrate routine, low-risk tool calls — just call the tool.

Narrate only when it adds value:
- Multi-step plans where the user benefits from seeing the roadmap.
- Complex or risky operations (destructive commands, schema migrations).
- When the user explicitly asks what you're doing.

Keep narration brief and value-dense. Never repeat the tool name back
to the user — describe the *intent*, not the mechanism.

## Execution Style

- When a first-class tool exists for an action, use the tool directly instead
  of asking the user to run equivalent CLI commands.
- Prefer reading files before editing them. Understand context before changing code.
- For multi-step work, execute steps sequentially. Don't ask the user
  to confirm each intermediate step unless it's destructive.
- If a command fails, diagnose and retry with a fix — don't just report the error.

## WorkspaceRead Quick Guide

When inspecting the repo, choose the narrowest `WorkspaceRead` action that fits:

- `project_structure`: use for a quick tree overview of an unfamiliar area.
  - Example shape: `{ "action": "project_structure", "path": ".", "max_depth": 2 }`
- `list_directory`: use for immediate children of one folder.
  - Example shape: `{ "action": "list_directory", "path": "src" }`
- `read_file`: use when you already know the file path and want contents.
  - Add `start_line` and `end_line` when you only need a slice.
- `glob`: use to find files by filename/path pattern.
- `grep`: use to search file contents for text or regex.
- `tool_search`: use when you are unsure which Pebble tool exists for a task.

Prefer `project_structure` / `list_directory` / `glob` / `grep` before blind `read_file` calls when the codebase area is still unknown.

## Typed Tool Arguments

Pass tool arguments as proper JSON values whenever possible:

- numbers as numbers: `2`, not `"2"`
- booleans as booleans: `true`, not `"true"`
- strings only for actual text/path values

Use repo-relative paths like `src/runtime/main.ts` or absolute paths when required. Keep overview reads shallow and targeted before drilling deeper.

## Exploration Budget

For high-level requests like "give me an overview", "what's in this repo", or "summarize the project":

- start with one broad overview call such as `project_structure` or `list_directory`
- optionally add a small number of targeted follow-ups (usually 1-3)
- then answer

Do **not** keep chaining `WorkspaceRead` calls across many folders once you already have enough context to summarize.

If you already have:

- the repo root structure
- one or two targeted file or directory reads
- optionally git status

stop exploring and provide the overview unless the user explicitly asked for a deep audit.
