# pebble-code

Pebble defaults to **OpenRouter** as its first model provider.

## Configure the provider

- In the REPL, run `/login <api-key>` to save an OpenRouter API key to `.pebble/settings.json`
- Or run `/config` to inspect the current provider/model/base URL and update them
- Environment fallback is also supported via `OPENROUTER_API_KEY`

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
