/**
 * Runtime main entry point.
 *
 * This is the full runtime boot — called after fast-path checks pass.
 * It initializes config, trust, providers, extensions, and starts
 * either the interactive REPL or headless mode.
 */

import { BUILD_INFO, getVersionString } from "../build/buildInfo.js";
import { getFeatureSummary, isFeatureEnabled } from "../build/featureFlags.js";
import { buildRuntimeConfig } from "./config.js";
import { PermissionManager } from "./permissionManager.js";
import { loadRepositoryInstructions, formatInstructions } from "./instructions.js";

export interface RuntimeOptions {
  /** Run in headless/print mode */
  headless?: boolean;
  /** Input prompt for headless mode */
  prompt?: string;
  /** Session ID to resume */
  resume?: string;
  /** Working directory */
  cwd?: string;
  /** Model to use */
  model?: string;
  /** Provider to use */
  provider?: string;
  /** Abort signal */
  signal?: AbortSignal;
}

export async function run(options: RuntimeOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();

  // Phase 1: Log startup
  console.error(getVersionString());
  console.error(getFeatureSummary());
  console.error(`Mode: ${options.headless ? "headless" : "interactive"}`);
  console.error(`Working directory: ${cwd}`);

  // Phase 2: Initialize config layer
  const config = buildRuntimeConfig(cwd);
  console.error(`Trust level: ${config.trust.level}`);
  console.error(`Project root: ${config.trust.projectRoot}`);

  // Phase 3: Initialize trust system
  const permissionManager = new PermissionManager({
    mode: config.settings.permissionMode,
    projectRoot: config.trust.projectRoot,
  });

  // Phase 4: Load repository instructions
  const instructions = formatInstructions(config.instructions);
  if (instructions) {
    console.error(`Loaded ${config.instructions.length} instruction file(s)`);
  }

  // Phase 5: Initialize extensions (stub)
  // TODO: Load MCP servers, plugins, skills

  // Phase 6: Start the appropriate mode
  if (options.headless) {
    return runHeadless(options, config, permissionManager, instructions);
  }

  return runInteractive(options, config, permissionManager, instructions);
}

async function runHeadless(
  options: RuntimeOptions,
  config: ReturnType<typeof buildRuntimeConfig>,
  permissionManager: PermissionManager,
  instructions: string,
): Promise<number> {
  if (!options.prompt) {
    console.error("Error: headless mode requires --prompt");
    return 1;
  }

  console.error("Headless mode: processing prompt...");
  console.error(`Permission mode: ${config.settings.permissionMode}`);
  console.error(`Instructions: ${instructions ? "loaded" : "none"}`);

  // Output a structured result envelope for headless callers
  const result = {
    type: "result",
    status: "not_implemented",
    message: "Engine not yet implemented",
    sessionId: null,
  };

  console.log(JSON.stringify(result, null, 2));
  return 0;
}

async function runInteractive(
  _options: RuntimeOptions,
  config: ReturnType<typeof buildRuntimeConfig>,
  permissionManager: PermissionManager,
  instructions: string,
): Promise<number> {
  console.error("Interactive mode: starting REPL...");
  console.error(`Trust level: ${config.trust.level}`);
  console.error(`Permission mode: ${config.settings.permissionMode}`);
  console.error(`Instructions: ${instructions ? "loaded" : "none"}`);

  // Import Ink REPL dynamically to avoid blocking fast paths
  const { startREPL } = await import("../ui/App.js");

  const context = {
    cwd: config.cwd,
    headless: false,
    config: {
      trust: config.trust.level,
      permissionMode: config.settings.permissionMode,
      model: config.settings.model,
    },
  };

  return startREPL(context);
}
