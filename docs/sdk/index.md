---
title: "SDK"
summary: "Programmatic Pebble entrypoints exported from the package root."
read_when:
  - You want the actual SDK surface exported from index.ts and src/entrypoints/sdk.ts
  - You are integrating Pebble programmatically instead of only through the CLI
---

# SDK

Pebble exposes a programmatic surface from the package root via `index.ts`, which re-exports `src/entrypoints/sdk.ts`.

## Main exports

| Export | Purpose |
| --- | --- |
| `runSdk(options)` | boot Pebble through the normal runtime path |
| `runHeadless(options)` | convenience helper for headless execution |
| `query(messages, options)` | one-shot convenience wrapper around `QueryEngine` |
| `streamQuery(messages, options)` | async iterator wrapper around `QueryEngine.stream()` |
| `QueryEngine` | low-level engine class for custom integrations |
| `parseSdkEvent(line)` | parse one serialized SDK event |
| `serializeSdkEvent(event)` | serialize an SDK event back to NDJSON |

## Headless helper example

```ts
import { runHeadless } from "pebble-code";

await runHeadless({
  cwd: process.cwd(),
  prompt: "summarize the current repository",
  format: "json-stream",
});
```

## Lower-level query helpers

`query(...)` and `streamQuery(...)` are lower-level than `runSdk(...)` and `runHeadless(...)`.

They are useful when you already have:

- a provider instance
- a chosen tool set
- your own event handling or permission plumbing

## Event protocol

The headless/SDK protocol uses the event types defined in `src/engine/sdkProtocol.ts` and `src/engine/results.ts`.

The stable event families are:

- `init`
- `user_replay`
- `stream_event`
- `permission_denied`
- `result`

## Related pages

- [Headless mode](/cli/headless)
- [Sessions](/concepts/sessions)