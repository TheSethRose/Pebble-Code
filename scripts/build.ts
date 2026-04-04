#!/usr/bin/env bun
/**
 * Build script for Pebble Code.
 *
 * Performs:
 * 1. Type checking
 * 2. Macro injection for build metadata
 * 3. Bundling for distribution
 * 4. Feature flag injection
 */

import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
      entrypoints: [join(SRC, "entrypoints/cli.tsx")],
      outdir: DIST,
      target: "node",
      minify: true,
      sourcemap: "external",
      define: {
        "process.env.NODE_ENV": '"production"',
      },
    });

    if (!result.success) {
      console.error("❌ Build failed");
      for (const msg of result.logs) {
        console.error(msg);
      }
      process.exit(1);
    }

    // Rename cli.js to pebble.js for the start script
    const cliJs = join(DIST, "cli.js");
    const pebbleJs = join(DIST, "pebble.js");
    if (existsSync(cliJs)) {
      await $`mv ${cliJs} ${pebbleJs}`.cwd(ROOT);
    }

    console.log("✅ Bundle created in dist/pebble.js");
  } catch (err: unknown) {
    console.error("❌ Build failed");
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  // Step 4: Generate feature manifest documentation
  console.log("\n📋 Generating feature manifest...");
  await generateFeatureManifest();

  console.log(`\n✅ Build complete: ${DIST}/pebble.js`);
  console.log(`   Version: ${buildInfo.version}`);
  console.log(`   Commit:  ${buildInfo.commit}`);
  console.log(`   Variant: ${buildInfo.variant}`);
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
