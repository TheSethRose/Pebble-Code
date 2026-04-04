
# Pebble Code

A terminal-native AI coding agent that ships as both a `pebble` CLI (`src/entrypoints/cli.tsx`) and an embeddable headless SDK (`src/entrypoints/sdk.ts`). Architecture: entrypoints → runtime → engine → tools/providers, with session persistence and an Ink/React terminal UI.

See [private/ARCHITECTURE.md](private/ARCHITECTURE.md) for system design and [private/CODEBASE_TREE.md](private/CODEBASE_TREE.md) for the full file map.

## Bun Tooling

Default to Bun instead of Node.js for every task.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun install` instead of `npm install` / `yarn` / `pnpm`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bunx <package>` instead of `npx <package>`
- Prefer `Bun.file` over `node:fs` readFile/writeFile
- Use `Bun.$\`cmd\`` instead of execa
- Bun loads `.env` automatically — do not use dotenv

## Build & Verify

Run in this order before committing:

```sh
bun test              # unit + integration tests
bun run typecheck     # tsc --noEmit (strict)
bun run build         # production bundle → dist/pebble.js
```

Other useful scripts:

```sh
bun run dev           # run CLI directly from source (no build)
bun run lint          # Biome check + auto-fix
bun run clean         # typecheck + lint together
bun run hooks:install # set up pre-commit secret scanner
```

## Architecture

| Directory | Role |
|---|---|
| `src/entrypoints/` | CLI fast-paths and SDK surface (`runSdk`, `query`, `streamQuery`) |
| `src/runtime/` | Unified boot path — config, trust, permissions, session wiring |
| `src/engine/` | `QueryEngine` — drives the agent loop and streaming |
| `src/tools/` | One class per tool in `src/tools/PascalCaseTool/index.ts` |
| `src/providers/` | Provider catalog, config, and runtime resolution |
| `src/persistence/` | Session store, compaction, memory, todo store, resume flows |
| `src/extensions/` | Extension/skill loader contracts and runtime integration |
| `src/ui/` | Ink/React terminal UI (`App.tsx` + `components/`) |
| `src/build/` | Build metadata (`buildInfo.ts`) and feature flags |

Docs: [PROVIDERS.md](docs/PROVIDERS.md) · [EXTENSIONS.md](docs/EXTENSIONS.md) · [STATE_AND_RESUME.md](docs/STATE_AND_RESUME.md) · [HEADLESS_SDK.md](docs/HEADLESS_SDK.md)

## Conventions

- **Tools:** Each tool is a class implementing the `Tool` interface, one per directory (`src/tools/PascalCaseTool/index.ts`). Register in `src/tools/registry.ts`.
- **Zod schemas:** All tool inputs use Zod with `.describe()` annotations. Parameter names are `snake_case`.
- **TypeScript:** Full strict mode. Module resolution is Bun-native (`"module": "Preserve"`, `"moduleResolution": "bundler"`). JSX is `react-jsx` (Ink).
- **Linter/formatter:** Biome only — no ESLint, no Prettier. Run `bun run lint` to auto-fix.
- **No barrel files:** `src/` modules are named explicitly. Exception: `src/providers/primary/index.ts`.
- **No emit:** `tsc` is typecheck-only; Bun handles all compilation.

## Testing

Tests live in `tests/` and import directly from `../src/...` (no path aliases). Pattern: full integration with real file system, scripted stub providers, temp dirs cleaned in `afterEach`.

```ts
import { test, expect, describe, afterEach } from "bun:test";
```

See [tests/tools.test.ts](tests/tools.test.ts) and [tests/engine.test.ts](tests/engine.test.ts) for examples.
