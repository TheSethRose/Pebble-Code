---
title: "Sessions"
summary: "How Pebble persists transcripts, resumes sessions, compacts long history, and refreshes session memory."
read_when:
  - You want to document Pebble's durable conversation model
  - You are explaining resume, compaction, or session memory behavior
---

# Sessions

Pebble stores conversations as durable sessions under the project root.

## Where sessions live

Pebble creates its session store under:

```text
.pebble/sessions/
```

The runtime uses `createProjectSessionStore(cwd)` from `src/persistence/runtimeSessions.ts`.

## Resume behavior

Pebble supports two explicit resume paths today:

- `--resume <session-id>` from the CLI
- `/resume [session-id]` from the interactive UI

Headless runs also reuse the same session store through `createOrResumeSession(...)` in `src/persistence/runtimeSessions.ts`.

<Warning>
Fresh interactive launches do **not** auto-resume the latest session today. Starting Pebble without `--resume` begins a new chat until you explicitly resume one.
</Warning>

## Memory and compaction

Pebble keeps two layers of long-session support:

### Session memory

- Pebble can build and refresh a session memory summary
- `/memory` shows the current summary and token estimate
- `/memory refresh` rebuilds it
- `/memory clear` removes it
- resumed headless and interactive turns refresh stale memory before sending the next model request
- refreshed session memory is injected back into the conversation as a synthetic system message

### Compaction

When the configured transcript budget is exceeded, Pebble can compact older turns before sending them back to the model.

The important distinction is:

- the persisted transcript remains the source of truth
- the model receives a compacted conversation view when needed

This transcript compaction is separate from `ShellTool` output compaction. Shell output summaries are controlled by the `shellCompactionMode` setting in `.pebble/project-settings.json` or `~/.pebble/settings.json`.

## Headless and session reuse

Headless runs also use the same session store.

- `runHeadless(...)` and CLI `--headless` create or resume sessions
- the final run metadata is written back to the stored session
- stale pending tool approvals are failed on resume instead of silently carrying over

## Related pages

- [CLI overview](/cli/index)
- [Headless mode](/cli/headless)
- [SDK](/sdk/index)