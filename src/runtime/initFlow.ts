import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandContext } from "../commands/types.js";
import {
  getProjectSettingsPath,
  getSettingsPath,
  loadSettingsForCwd,
  saveProjectSettingsForCwd,
  type Settings,
} from "./config.js";
import { getDefaultExtensionDirs } from "../extensions/loaders.js";
import { loadPromptFiles, loadRepositoryInstructions } from "./instructions.js";
import { findProjectRoot } from "./trust.js";

export interface InitFlowReport {
  projectRoot: string;
  projectSettingsPath: string;
  projectSettingsExists: boolean;
  projectSettingsCreated: boolean;
  userSettingsPath: string;
  repositoryInstructionPaths: string[];
  promptFilePaths: string[];
  extensionDirs: string[];
  loadedSkills: number;
  loadedMcpServers: number;
  loadedExtensionCommands: number;
  loadedExtensionProviders: number;
  hookRegistryLoaded: boolean;
  seededDefaults: Partial<Settings>;
}

export function ensureProjectInit(
  cwd: string,
  context: Partial<CommandContext> = {},
  options: { writeProjectSettings?: boolean } = {},
): InitFlowReport {
  const projectRoot = findProjectRoot(cwd) ?? cwd;
  const projectSettingsPath = getProjectSettingsPath(projectRoot);
  const userSettingsPath = getSettingsPath(projectRoot);
  const repositoryInstructions = loadRepositoryInstructions(projectRoot);
  const promptFiles = loadPromptFiles(projectRoot);
  const seededDefaults = buildProjectInitDefaults(loadSettingsForCwd(projectRoot));
  const shouldWrite = options.writeProjectSettings !== false;
  const projectSettingsExists = existsSync(projectSettingsPath);
  let projectSettingsCreated = false;

  if (shouldWrite && !projectSettingsExists) {
    saveProjectSettingsForCwd(projectRoot, seededDefaults);
    projectSettingsCreated = true;
  }

  return {
    projectRoot,
    projectSettingsPath,
    projectSettingsExists: projectSettingsExists || projectSettingsCreated,
    projectSettingsCreated,
    userSettingsPath,
    repositoryInstructionPaths: repositoryInstructions.map((entry) => entry.path),
    promptFilePaths: promptFiles.map((entry) => entry.path),
    extensionDirs: getDefaultExtensionDirs(projectRoot),
    loadedSkills: context.loadedSkills?.length ?? 0,
    loadedMcpServers: context.loadedMcpServers?.length ?? 0,
    loadedExtensionCommands: context.extensionCommandNames?.length ?? context.extensionCommands?.length ?? 0,
    loadedExtensionProviders: context.extensionProviders?.length ?? 0,
    hookRegistryLoaded: Boolean(context.hookRegistry),
    seededDefaults,
  };
}

export function formatInitFlowReport(report: InitFlowReport): string {
  const seededDefaults = Object.entries(report.seededDefaults)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");

  return [
    `Pebble init for ${report.projectRoot}`,
    report.projectSettingsCreated
      ? `Created project settings: ${report.projectSettingsPath}`
      : report.projectSettingsExists
        ? `Project settings: ${report.projectSettingsPath}`
        : `Project settings not written yet: ${report.projectSettingsPath}`,
    `User overrides: ${report.userSettingsPath}`,
    `Repository instructions: ${report.repositoryInstructionPaths.length}`,
    `Prompt overlays in ${join(report.projectRoot, ".pebble", "prompts")}: ${report.promptFilePaths.length}`,
    `Extension dirs: ${report.extensionDirs.join(", ")}`,
    `Loaded runtime integrations: ${report.loadedSkills} skill(s), ${report.loadedMcpServers} MCP server(s), ${report.loadedExtensionCommands} extension command(s), ${report.loadedExtensionProviders} extension provider(s)` ,
    `Hooks loaded: ${report.hookRegistryLoaded ? "yes" : "no"}`,
    seededDefaults ? `Seeded safe project defaults: ${seededDefaults}` : undefined,
    "",
    "Next steps:",
    `- Commit safe team defaults in ${report.projectSettingsPath}`,
    `- Keep secrets and personal overrides in ${report.userSettingsPath}`,
    "- Add .pebble/prompts/*.md only when you want local prompt overlays; Pebble already auto-loads repo instructions and local skills.",
  ].filter(Boolean).join("\n");
}

function buildProjectInitDefaults(settings: Settings): Partial<Settings> {
  const defaults: Partial<Settings> = {
    permissionMode: settings.permissionMode,
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    maxTurns: settings.maxTurns,
    telemetryEnabled: settings.telemetryEnabled,
    compactThreshold: settings.compactThreshold,
    compactPrepareThreshold: settings.compactPrepareThreshold,
    compactionInstructions: settings.compactionInstructions,
    shellCompactionMode: settings.shellCompactionMode,
    providerCompactionMarkers: settings.providerCompactionMarkers,
    worktreeStartupMode: settings.worktreeStartupMode,
    fullscreenRenderer: settings.fullscreenRenderer,
  };

  return Object.fromEntries(
    Object.entries(defaults).filter(([, value]) => value !== undefined),
  ) as Partial<Settings>;
}