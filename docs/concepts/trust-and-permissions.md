---
title: "Trust and Permissions"
summary: "How Pebble decides whether a workspace is trusted and how risky tool execution is gated."
read_when:
  - You want the current runtime trust model
  - You are documenting permission behavior in interactive or headless mode
---

# Trust and Permissions

Pebble separates two related ideas:

- **trust level** for the current working directory
- **permission mode** for risky tool execution

## Trust levels

The trust model is defined in `src/runtime/trust.ts` and `src/runtime/permissions.ts`.

| Trust level | Meaning |
| --- | --- |
| `trusted` | project hooks and repository instructions are enabled |
| `untrusted` | project-scoped behavior is restricted |
| `bare` | minimal mode that bypasses most dynamic loading |

## How trust is determined

Pebble checks the project root for a `.pebble-trust` marker file first.

- `trusted` in the file forces trusted mode
- `bare` in the file forces bare mode

If no marker file exists, Pebble treats directories with recognizable project markers like `package.json`, `tsconfig.json`, `.git`, `pyproject.toml`, or `go.mod` as trusted.

## Permission modes

Permission modes are defined in `src/runtime/permissions.ts`.

| Mode | Meaning |
| --- | --- |
| `always-ask` | prompt for every risky action |
| `auto-edit` | auto-approve file edits, but still ask for shell-style actions |
| `auto-all` | auto-approve risky tools |
| `restricted` | deny risky tools |

## What users see

In the interactive UI:

- risky actions can raise a permission prompt
- permission status is visible through `/permissions`

In headless mode:

- Pebble does not open an interactive approval prompt
- blocked tools surface as permission failures in the event/output stream

## Practical effect of trust

When the runtime is not trusted, Pebble disables project-scoped instruction loading and project hook behavior.

## Related pages

- [Configuration](/concepts/configuration)
- [Headless mode](/cli/headless)
- [Troubleshooting](/help/troubleshooting)