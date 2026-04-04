---
title: "Troubleshooting"
summary: "Fix the most common Pebble product issues: provider auth, trust, headless output, resume, and extension loading."
read_when:
  - Pebble boots but does not behave the way you expect
  - You need short, actionable product troubleshooting steps
---

# Troubleshooting

## The provider is "not configured"

This usually means Pebble resolved a provider successfully, but does not have the credential, base URL, or model information it needs.

Try one of these:

- set the provider env var, such as `OPENROUTER_API_KEY`
- use `/login <provider> <credential>`
- open `/config` and check provider/model settings

## The provider is cataloged but not runnable

Some provider ids exist in the catalog before the full runtime adapter exists.

If you see a message that a provider is **cataloged in Pebble** but not implemented yet, switch to a currently runnable provider such as `openrouter` or `openai`.

## Headless output is mixed with logs

Pebble keeps its human-readable startup diagnostics on `stderr` and its result stream on `stdout`.

- parse `stdout` for text, JSON, or NDJSON results
- treat `stderr` as operator diagnostics

## `/resume` works, but a fresh launch does not restore the last session

That is current behavior.

- use `/resume` in the interactive UI
- or start Pebble with `--resume <session-id>`

Fresh launches do not auto-resume the latest session today.

## Repository instructions are not loading

Check the trust level.

- `trusted` enables repository instructions and hooks
- `untrusted` restricts project-scoped behavior
- `bare` bypasses most dynamic loading

Pebble derives trust from project markers and the optional `.pebble-trust` file.

## An extension failed to load

Pebble isolates extension failures instead of crashing the whole runtime.

Check the runtime diagnostics for the failing extension name and error, then inspect the relevant local extension directory:

- `extensions/`
- `.pebble/extensions/`

## The settings file is not where I expected

Pebble writes user overrides to:

```text
~/.pebble/settings.json
```

Committed project defaults belong in:

```text
.pebble/project-settings.json
```