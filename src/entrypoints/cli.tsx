#!/usr/bin/env bun
/**
 * Pebble Code — CLI entrypoint.
 *
 * Implements fast-path routing for utility commands that should
 * respond instantly without booting the full runtime.
 *
 * Fast paths:
 *   --version, -v    → print version and exit
 *   --help, -h       → print help and exit
 *   --features       → print feature flag summary
 *   --build-info     → print build metadata
 *
 * All other paths fall through to the full runtime boot.
 */

import { BUILD_INFO, getVersionString } from "../build/buildInfo.js";
import {
  FEATURE_FLAGS,
  getFeatureSummary,
  getEnabledFeatures,
} from "../build/featureFlags.js";

// ─── Fast paths ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const firstArg = args[0];

if (firstArg === "--version" || firstArg === "-v") {
  console.log(getVersionString());
  process.exit(0);
}

if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
  process.exit(0);
}

if (firstArg === "--features") {
  console.log(getFeatureSummary());
  console.log("\nEnabled features:");
  for (const flag of getEnabledFeatures()) {
    console.log(`  ✓ ${flag.name} — ${flag.description}`);
  }
  process.exit(0);
}

if (firstArg === "--build-info") {
  console.log(JSON.stringify(BUILD_INFO, null, 2));
  process.exit(0);
}

// ─── Runtime flags ───────────────────────────────────────────────────────────

const runtimeOptions = {
  headless: args.includes("--headless") || args.includes("-p"),
  prompt: getFlagValue(args, "--prompt"),
  resume: getFlagValue(args, "--resume"),
  model: getFlagValue(args, "--model"),
  provider: getFlagValue(args, "--provider"),
  format: getFlagValue(args, "--format"),
  cwd: getFlagValue(args, "--cwd") ?? process.cwd(),
};

// ─── Boot the full runtime ───────────────────────────────────────────────────

async function main() {
  const { run } = await import("../runtime/main.js");
  const exitCode = await run(runtimeOptions);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printHelp() {
  console.log(`
${getVersionString()}

USAGE
  pebble [options]
  pebble <command> [options]

FAST COMMANDS (no runtime boot)
  --version, -v       Print version and exit
  --help, -h          Print this help and exit
  --features          Print feature flag summary
  --build-info        Print build metadata

RUNTIME OPTIONS
  --headless, -p      Run in headless/print mode
  --prompt <text>     Input prompt for headless mode
  --resume <id>       Resume a previous session
  --model <name>      Override the model to use
  --provider <name>   Override the provider to use
  --format <type>     Headless output format: text, json, or json-stream
  --cwd <path>        Set the working directory

SLASH COMMANDS (interactive mode)
  /help               Show available commands
  /clear              Clear the current session
  /exit               Exit the REPL
  /login              Save provider credentials
  /model              Change the model
  /config             Show current configuration
  /resume             Resume a previous session
  /permissions        Manage permissions
  /plan               Show the current plan
  /review             Review changes

EXAMPLES
  pebble                          # Start interactive REPL
  pebble --headless --prompt "fix the bug in src/index.ts"
  pebble --headless --format json-stream --prompt "summarize README.md"
  pebble --resume abc123
  pebble --model claude-sonnet-4-20250514
  pebble --provider openrouter
`);
}
