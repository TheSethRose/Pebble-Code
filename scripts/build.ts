#!/usr/bin/env bun
/**
 * Build script for Pebble Code.
 *
 * Performs:
 * 1. Type checking
 * 2. Macro injection for build metadata
 * 3. Bundling for distribution
 * 4. Smoke verification of bundled output
 * 5. Feature manifest generation
 */

import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = import.meta.dir + "/..";
const DIST = join(ROOT, "dist");
const SRC = join(ROOT, "src");

// ─── Build metadata ──────────────────────────────────────────────────────────

const buildInfo = {
  version: process.env.npm_package_version ?? "0.1.0",
  buildDate: new Date().toISOString().split("T")[0],
  commit: await getGitCommit(),
  variant: process.env.PEBBLE_VARIANT ?? "stable",
};

async function getGitCommit(): Promise<string> {
  try {
    const result = await $`git rev-parse --short HEAD`.cwd(ROOT).quiet();
    return String(result.stdout).trim();
  } catch {
    return "unknown";
  }
}

// ─── Main build ──────────────────────────────────────────────────────────────

async function build() {
  console.log(`🔨 Building Pebble Code v${buildInfo.version} (${buildInfo.variant})`);

  // Step 1: Type check
  console.log("\n📝 Type checking...");
  try {
    await $`bunx tsc --noEmit`.cwd(ROOT);
    console.log("✅ Type check passed");
  } catch (err: unknown) {
    console.error("❌ Type check failed");
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  // Step 2: Create dist directory
  if (!existsSync(DIST)) {
    mkdirSync(DIST, { recursive: true });
  }

  // Step 3: Write build metadata JSON
  writeFileSync(
    join(DIST, "build-meta.json"),
    JSON.stringify(buildInfo, null, 2)
  );
  console.log("📦 Wrote dist/build-meta.json");

  // Step 4: Bundle for distribution
  console.log("\n📦 Bundling...");
  try {
    const result = await Bun.build({
      entrypoints: [
        join(SRC, "entrypoints/cli.tsx"),
        join(SRC, "entrypoints/telegram.ts"),
      ],
      outdir: DIST,
      target: "bun",
      minify: true,
      sourcemap: "external",
      define: {
        "process.env.NODE_ENV": '"production"',
      },
    });

    if (!result.success) {
      console.error("❌ Build failed");
      for (const msg of result.logs) {
        const parts = [
          msg.message,
          "detail" in msg ? msg.detail : undefined,
          "name" in msg ? msg.name : undefined,
        ].filter(Boolean);
        console.error(parts.length > 0 ? parts.join("\n") : JSON.stringify(msg, null, 2));
      }
      process.exit(1);
    }

    // Rename entrypoint bundles to their published executable names.
    const cliJs = join(DIST, "cli.js");
    const pebbleJs = join(DIST, "pebble.js");
    if (existsSync(cliJs)) {
      if (existsSync(pebbleJs)) {
        rmSync(pebbleJs);
      }
      renameSync(cliJs, pebbleJs);
    }

    const telegramJs = join(DIST, "telegram.js");
    const pebbleTelegramJs = join(DIST, "pebble-telegram.js");
    if (existsSync(telegramJs)) {
      if (existsSync(pebbleTelegramJs)) {
        rmSync(pebbleTelegramJs);
      }
      renameSync(telegramJs, pebbleTelegramJs);
    }

    console.log("✅ Bundles created in dist/pebble.js and dist/pebble-telegram.js");
  } catch (err: unknown) {
    console.error("❌ Build failed");
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  // Step 5: Verify the bundled output across success and failure paths
  console.log("\n🧪 Verifying bundled output...");
  try {
    await verifyBundledEntrypoints();
    console.log("✅ Bundled entrypoints passed success and failure-path verification");
  } catch (err: unknown) {
    console.error("❌ Bundled output verification failed");
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  // Step 6: Generate feature manifest documentation
  console.log("\n📋 Generating feature manifest...");
  await generateFeatureManifest();

  console.log(`\n✅ Build complete: ${DIST}/pebble.js`);
  console.log(`   Version: ${buildInfo.version}`);
  console.log(`   Commit:  ${buildInfo.commit}`);
  console.log(`   Variant: ${buildInfo.variant}`);
}

type SpawnResult = ReturnType<typeof Bun.spawnSync>;

function runBundledCli(...args: string[]): SpawnResult {
  const smokeCwd = createSmokeProjectDir();
  const smokePebbleHome = join(smokeCwd, ".pebble-home");
  mkdirSync(smokePebbleHome, { recursive: true });

  return Bun.spawnSync({
    cmd: [process.execPath, join(DIST, "pebble.js"), ...args],
    cwd: smokeCwd,
    env: {
      ...process.env,
      HOME: smokeCwd,
      PEBBLE_HOME: smokePebbleHome,
      PEBBLE_PROVIDER: "",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      COPILOT_GITHUB_TOKEN: "",
      GITHUB_COPILOT_TOKEN: "",
      COPILOT_TOKEN: "",
      OPENROUTER_API_KEY: "",
      OPENROUTER_BASE_URL: "",
      OPENROUTER_MODEL: "",
      PEBBLE_API_KEY: "",
      PEBBLE_API_BASE: "",
      PEBBLE_MODEL: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function createSmokeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pebble-build-smoke-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "pebble-build-smoke", private: true }, null, 2),
    "utf-8",
  );
  return dir;
}

function outputOf(result: SpawnResult): string {
  const stdout = stdoutOf(result);
  const stderr = stderrOf(result);
  return `${stdout}${stderr}`.trim();
}

function stdoutOf(result: SpawnResult): string {
  return result.stdout ? result.stdout.toString() : "";
}

function stderrOf(result: SpawnResult): string {
  return result.stderr ? result.stderr.toString() : "";
}

function assertSuccess(result: SpawnResult, label: string): string {
  if (result.exitCode !== 0) {
    throw new Error(`${label} exited with ${result.exitCode}: ${outputOf(result)}`);
  }

  return outputOf(result);
}

function assertFailure(result: SpawnResult, label: string): string {
  if (result.exitCode === 0) {
    throw new Error(`${label} was expected to fail but exited successfully: ${outputOf(result)}`);
  }

  return outputOf(result);
}

async function verifyBundledCli(): Promise<void> {
  const buildInfoResult = assertSuccess(runBundledCli("--build-info"), "--build-info");
  const bundledInfo = JSON.parse(buildInfoResult) as typeof buildInfo;

  if (
    bundledInfo.version !== buildInfo.version ||
    bundledInfo.variant !== buildInfo.variant ||
    bundledInfo.commit !== buildInfo.commit ||
    bundledInfo.buildDate !== buildInfo.buildDate
  ) {
    throw new Error(
      `Bundled build metadata mismatch. Expected ${JSON.stringify(buildInfo)}, received ${JSON.stringify(bundledInfo)}`,
    );
  }

  const versionOutput = assertSuccess(runBundledCli("--version"), "--version");
  if (!versionOutput.includes(buildInfo.version) || !versionOutput.includes(buildInfo.variant)) {
    throw new Error(`--version output missing expected build metadata: ${versionOutput}`);
  }

  const helpOutput = assertSuccess(runBundledCli("--help"), "--help");
  if (!helpOutput.includes("USAGE") || !helpOutput.includes("FAST COMMANDS")) {
    throw new Error(`--help output missing expected sections: ${helpOutput}`);
  }

  const featuresOutput = assertSuccess(runBundledCli("--features"), "--features");
  if (!featuresOutput.includes("Enabled features:")) {
    throw new Error(`--features output missing enabled-features summary: ${featuresOutput}`);
  }

  const headlessSuccess = runBundledCli("--headless", "--format", "json", "--prompt", "health check");
  const headlessSuccessStdout = stdoutOf(headlessSuccess).trim();
  if (headlessSuccess.exitCode !== 0) {
    throw new Error(`--headless --prompt exited with ${headlessSuccess.exitCode}: ${outputOf(headlessSuccess)}`);
  }

  const headlessResult = JSON.parse(headlessSuccessStdout) as {
    status: string;
    data?: {
      success?: boolean;
      messages?: Array<{ role: string; content: string }>;
    };
  };

  if (!headlessResult.data?.success || headlessResult.status !== "success") {
    throw new Error(`Headless bundled execution did not report success: ${headlessSuccessStdout}`);
  }

  if (!headlessResult.data.messages?.some((message) => message.role === "assistant")) {
    throw new Error(`Headless bundled execution did not include an assistant response: ${headlessSuccessStdout}`);
  }

  const headlessFailureOutput = assertFailure(runBundledCli("--headless"), "--headless without prompt");
  if (!headlessFailureOutput.includes("headless mode requires --prompt")) {
    throw new Error(`Expected headless failure message not found: ${headlessFailureOutput}`);
  }
}

function runBundledTelegram(...args: string[]): SpawnResult {
  const smokeCwd = createSmokeProjectDir();
  const smokePebbleHome = join(smokeCwd, ".pebble-home");
  mkdirSync(smokePebbleHome, { recursive: true });

  return Bun.spawnSync({
    cmd: [process.execPath, join(DIST, "pebble-telegram.js"), ...args],
    cwd: smokeCwd,
    env: {
      ...process.env,
      HOME: smokeCwd,
      PEBBLE_HOME: smokePebbleHome,
      PEBBLE_TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_BOT_TOKEN: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function verifyBundledEntrypoints(): Promise<void> {
  await verifyBundledCli();

  const telegramHelp = assertSuccess(runBundledTelegram("--help"), "telegram --help");
  if (!telegramHelp.includes("Pebble Telegram runtime") || !telegramHelp.includes("--bot-token")) {
    throw new Error(`Telegram help output missing expected flags: ${telegramHelp}`);
  }
}

// ─── Feature manifest generation ─────────────────────────────────────────────

async function generateFeatureManifest() {
  const manifestPath = join(ROOT, "docs/FEATURES_RECREATED.md");

  // Import feature flags dynamically
  const { FEATURE_FLAGS } = await import("../src/build/featureFlags.js");

  let md = `# Feature Manifest\n\n`;
  md += `Generated: ${new Date().toISOString()}\n`;
  md += `Variant: ${buildInfo.variant}\n\n`;

  const categories = ["core", "beta", "runtime-optional", "deferred", "dropped"] as const;

  for (const category of categories) {
    const flags = Object.values(FEATURE_FLAGS).filter(
      (f) => f.category === category
    );
    if (flags.length === 0) continue;

    md += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
    md += `| Flag | Enabled | Description |\n`;
    md += `|------|---------|-------------|\n`;

    for (const flag of flags) {
      md += `| \`${flag.name}\` | ${flag.enabled ? "✓" : "✗"} | ${flag.description} |\n`;
    }
    md += "\n";
  }

  writeFileSync(manifestPath, md);
  console.log("   Generated docs/FEATURES_RECREATED.md");
}

// ─── Run ─────────────────────────────────────────────────────────────────────

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
