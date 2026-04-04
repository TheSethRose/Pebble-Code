/**
 * Extension loader for MCP, plugins, and skills.
 * Isolates extension failures from core runtime.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "../commands/types.js";
import type { Provider } from "../providers/types.js";
import type { Tool } from "../tools/Tool.js";
import type {
  Extension,
  ExtensionType,
  McpServerConfig,
  Skill,
} from "./contracts.js";

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  type: ExtensionType;
  description?: string;
  source: "directory" | "settings";
}

export interface ExtensionResult {
  manifest: ExtensionManifest;
  loaded: boolean;
  error?: string;
  extension?: Extension;
  skills?: Skill[];
  mcpServers?: McpServerConfig[];
  entryPath?: string;
}

export interface RuntimeIntegrations {
  results: ExtensionResult[];
  extensions: Extension[];
  commands: Command[];
  tools: Tool[];
  providers: Provider[];
  skills: Skill[];
  mcpServers: McpServerConfig[];
}

interface DiscoveredEntry {
  path: string;
  kind: "module" | "skill-markdown";
}

interface SkillFileMetadata {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  triggers?: string[];
  requiredTools?: string[];
}

const SUPPORTED_EXTENSION_SUFFIXES = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

export function getDefaultExtensionDirs(cwd: string): string[] {
  return [
    join(cwd, "extensions"),
    join(cwd, ".pebble", "extensions"),
  ];
}

export async function loadRuntimeIntegrations(
  extensionDirs: string[],
  options: { mcpServers?: unknown } = {},
): Promise<RuntimeIntegrations> {
  const extensionResults = await loadExtensions(extensionDirs);
  const configuredMcpResults = loadConfiguredMcpServers(options.mcpServers);
  const results = [...extensionResults, ...configuredMcpResults];

  const extensions = extensionResults
    .filter((result): result is ExtensionResult & { extension: Extension } => result.loaded && Boolean(result.extension))
    .map((result) => result.extension);
  const skills = extensionResults
    .filter((result) => result.loaded)
    .flatMap((result) => result.skills ?? []);
  const mcpServers = results
    .filter((result) => result.loaded)
    .flatMap((result) => result.mcpServers ?? []);
  const commands = extensions.flatMap((extension) => extension.commands ?? []);
  const tools = extensions.flatMap((extension) => extension.tools ?? []);
  const providers = extensions.flatMap((extension) => extension.providers ?? []);

  return {
    results,
    extensions,
    commands,
    tools,
    providers,
    skills,
    mcpServers,
  };
}

/**
 * Load extensions from a directory.
 * Failures are isolated — bad extensions don't break the core.
 */
export async function loadExtensions(
  extensionDirs: string[],
): Promise<ExtensionResult[]> {
  const results: ExtensionResult[] = [];

  for (const dir of extensionDirs) {
    for (const entry of discoverExtensionEntries(dir)) {
      try {
        const result = entry.kind === "skill-markdown"
          ? loadSkillMarkdownEntry(entry.path)
          : await loadModuleEntry(entry.path);
        results.push(result);
      } catch (error) {
        results.push({
          manifest: {
            id: basename(entry.path),
            name: basename(entry.path),
            version: "0.0.0",
            type: entry.kind === "skill-markdown" ? "skill" : "plugin",
            source: "directory",
          },
          loaded: false,
          error: error instanceof Error ? error.message : String(error),
          entryPath: entry.path,
        });
      }
    }
  }

  return results;
}

export function loadConfiguredMcpServers(mcpServers: unknown): ExtensionResult[] {
  const entries = normalizeConfiguredMcpEntries(mcpServers);

  return entries.map(({ name, value }) => {
    const normalized = normalizeMcpServerConfig({
      ...(value ?? {}),
      name: typeof (value as { name?: unknown } | undefined)?.name === "string"
        ? (value as { name: string }).name
        : name,
    });

    if (!normalized.success) {
      return {
        manifest: {
          id: `mcp:${name}`,
          name,
          version: "settings",
          type: "mcp",
          source: "settings",
        },
        loaded: false,
        error: normalized.error,
      } satisfies ExtensionResult;
    }

    return {
      manifest: {
        id: `mcp:${normalized.config.name}`,
        name: normalized.config.name,
        version: "settings",
        type: "mcp",
        source: "settings",
      },
      loaded: true,
      mcpServers: [normalized.config],
    } satisfies ExtensionResult;
  });
}

export function composeSkillInstructions(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  return [
    "## Loaded local skills",
    ...skills.map((skill) => [
      `### ${skill.name}`,
      skill.instructions.trim(),
    ].join("\n\n")),
  ].join("\n\n");
}

/**
 * Report extension loading status.
 */
export function reportExtensionStatus(results: ExtensionResult[]): void {
  const loaded = results.filter((result) => result.loaded).length;
  const failed = results.filter((result) => !result.loaded).length;

  if (loaded > 0) {
    console.error(`Loaded ${loaded} integration entr${loaded === 1 ? "y" : "ies"}`);
  }
  if (failed > 0) {
    console.error(`Failed to load ${failed} integration entr${failed === 1 ? "y" : "ies"}:`);
    for (const result of results.filter((value) => !value.loaded)) {
      console.error(`  - ${result.manifest.type}:${result.manifest.name}: ${result.error}`);
    }
  }
}

function discoverExtensionEntries(dir: string): DiscoveredEntry[] {
  if (!existsSync(dir)) {
    return [];
  }

  const entries: DiscoveredEntry[] = readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const discovered: DiscoveredEntry[] = [
          join(entryPath, "index.ts"),
          join(entryPath, "index.js"),
          join(entryPath, "index.mjs"),
          join(entryPath, "index.cjs"),
        ]
          .filter((candidate) => existsSync(candidate))
          .map((candidate) => ({ path: candidate, kind: "module" as const }));

        const skillMarkdown = join(entryPath, "SKILL.md");
        if (existsSync(skillMarkdown)) {
          discovered.push({ path: skillMarkdown, kind: "skill-markdown" });
        }

        return discovered;
      }

      if (entry.name === "SKILL.md") {
        return [{ path: entryPath, kind: "skill-markdown" as const }];
      }

      return SUPPORTED_EXTENSION_SUFFIXES.has(extname(entryPath))
        ? [{ path: entryPath, kind: "module" as const }]
        : [];
    });

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function loadModuleEntry(entryPath: string): Promise<ExtensionResult> {
  const moduleUrl = pathToFileURL(resolve(entryPath)).href;
  const loaded = await import(moduleUrl);
  const plugin = resolveExtensionExport(loaded);

  if (plugin) {
    if (plugin.hooks?.onActivate) {
      await plugin.hooks.onActivate();
    }

    const type = plugin.metadata.type ?? "plugin";
    if (type === "skill") {
      const skillResult = resolveSkillModuleEntry(loaded, entryPath, plugin.metadata);
      if (skillResult) {
        return skillResult;
      }
    }

    if (type === "mcp") {
      const mcpResult = resolveMcpModuleEntry(loaded, entryPath, plugin.metadata);
      if (mcpResult) {
        return mcpResult;
      }
    }

    return {
      manifest: {
        id: plugin.metadata.id,
        name: plugin.metadata.name,
        version: plugin.metadata.version,
        type: "plugin",
        description: plugin.metadata.description,
        source: "directory",
      },
      loaded: true,
      extension: plugin,
      entryPath,
    };
  }

  const skillResult = resolveSkillModuleEntry(loaded, entryPath);
  if (skillResult) {
    return skillResult;
  }

  const mcpResult = resolveMcpModuleEntry(loaded, entryPath);
  if (mcpResult) {
    return mcpResult;
  }

  throw new Error("Module does not export a valid plugin, skill, or MCP entry");
}

function loadSkillMarkdownEntry(entryPath: string): ExtensionResult {
  const instructions = readFileSync(entryPath, "utf-8").trim();
  if (instructions.length === 0) {
    throw new Error("SKILL.md is empty");
  }

  const metadata = readSkillFileMetadata(dirname(entryPath));
  const fallbackName = extractSkillNameFromMarkdown(instructions) ?? basename(dirname(entryPath));
  const skill: Skill = {
    id: metadata.id ?? slugify(fallbackName),
    name: metadata.name ?? fallbackName,
    version: metadata.version ?? "0.0.0",
    description: metadata.description,
    triggers: metadata.triggers ?? [],
    instructions,
    requiredTools: metadata.requiredTools,
    sourcePath: entryPath,
  };

  return {
    manifest: {
      id: skill.id,
      name: skill.name,
      version: skill.version ?? "0.0.0",
      type: "skill",
      description: skill.description,
      source: "directory",
    },
    loaded: true,
    skills: [skill],
    entryPath,
  };
}

function resolveExtensionExport(loaded: Record<string, unknown>): Extension | null {
  const candidates = [loaded.default, loaded.extension, loaded.plugin];
  for (const candidate of candidates) {
    if (isExtension(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveSkillModuleEntry(
  loaded: Record<string, unknown>,
  entryPath: string,
  metadata?: { id: string; name: string; version: string; description?: string },
): ExtensionResult | null {
  const candidates = [loaded.default, loaded.skill, loaded.skills, loaded.extension];

  for (const candidate of candidates) {
    const skills = normalizeSkillCandidates(candidate, entryPath, metadata);
    if (skills.length === 0) {
      continue;
    }

    return {
      manifest: {
        id: metadata?.id ?? skills[0]?.id ?? basename(entryPath),
        name: metadata?.name ?? skills[0]?.name ?? basename(entryPath),
        version: metadata?.version ?? skills[0]?.version ?? "0.0.0",
        type: "skill",
        description: metadata?.description ?? skills[0]?.description,
        source: "directory",
      },
      loaded: true,
      skills,
      entryPath,
    };
  }

  return null;
}

function resolveMcpModuleEntry(
  loaded: Record<string, unknown>,
  entryPath: string,
  metadata?: { id: string; name: string; version: string; description?: string },
): ExtensionResult | null {
  const candidates = [loaded.default, loaded.mcp, loaded.mcpServers, loaded.extension];

  for (const candidate of candidates) {
    const mcpServers = normalizeMcpCandidates(candidate);
    if (mcpServers.length === 0) {
      continue;
    }

    return {
      manifest: {
        id: metadata?.id ?? `mcp:${mcpServers[0]?.name ?? basename(entryPath)}`,
        name: metadata?.name ?? mcpServers[0]?.name ?? basename(entryPath),
        version: metadata?.version ?? "0.0.0",
        type: "mcp",
        description: metadata?.description,
        source: "directory",
      },
      loaded: true,
      mcpServers,
      entryPath,
    };
  }

  return null;
}

function normalizeSkillCandidates(
  value: unknown,
  entryPath: string,
  metadata?: { id: string; name: string; version: string; description?: string },
): Skill[] {
  if (Array.isArray(value)) {
    return value.flatMap((candidate, index) => {
      const normalized = normalizeSkill(candidate, entryPath, metadata, index);
      return normalized ? [normalized] : [];
    });
  }

  if (value && typeof value === "object" && Array.isArray((value as { skills?: unknown[] }).skills)) {
    return ((value as { skills: unknown[] }).skills)
      .flatMap((candidate, index) => {
        const normalized = normalizeSkill(candidate, entryPath, metadata, index);
        return normalized ? [normalized] : [];
      });
  }

  const normalized = normalizeSkill(value, entryPath, metadata, 0);
  return normalized ? [normalized] : [];
}

function normalizeSkill(
  value: unknown,
  entryPath: string,
  metadata?: { id: string; name: string; version: string; description?: string },
  index = 0,
): Skill | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<Skill> & {
    metadata?: { id?: string; name?: string; version?: string; description?: string };
  };
  const candidateMetadata = candidate.metadata;
  const instructions = typeof candidate.instructions === "string"
    ? candidate.instructions.trim()
    : undefined;

  if (!instructions) {
    return null;
  }

  const id = candidate.id
    ?? candidateMetadata?.id
    ?? metadata?.id
    ?? `${basename(entryPath)}-${index + 1}`;
  const name = candidate.name
    ?? candidateMetadata?.name
    ?? metadata?.name
    ?? basename(entryPath);

  return {
    id,
    name,
    version: candidate.version ?? candidateMetadata?.version ?? metadata?.version ?? "0.0.0",
    description: candidate.description ?? candidateMetadata?.description ?? metadata?.description,
    triggers: Array.isArray(candidate.triggers)
      ? candidate.triggers.filter((trigger): trigger is string => typeof trigger === "string")
      : [],
    instructions,
    requiredTools: Array.isArray(candidate.requiredTools)
      ? candidate.requiredTools.filter((tool): tool is string => typeof tool === "string")
      : undefined,
    sourcePath: candidate.sourcePath ?? entryPath,
  };
}

function normalizeMcpCandidates(value: unknown): McpServerConfig[] {
  if (Array.isArray(value)) {
    return value.flatMap((candidate) => {
      const normalized = normalizeMcpServerConfig(candidate);
      return normalized.success ? [normalized.config] : [];
    });
  }

  if (value && typeof value === "object" && Array.isArray((value as { mcpServers?: unknown[] }).mcpServers)) {
    return ((value as { mcpServers: unknown[] }).mcpServers).flatMap((candidate) => {
      const normalized = normalizeMcpServerConfig(candidate);
      return normalized.success ? [normalized.config] : [];
    });
  }

  const normalized = normalizeMcpServerConfig(value);
  return normalized.success ? [normalized.config] : [];
}

function normalizeMcpServerConfig(value: unknown):
  | { success: true; config: McpServerConfig }
  | { success: false; error: string } {
  if (!value || typeof value !== "object") {
    return { success: false, error: "MCP entry must be an object" };
  }

  const candidate = value as Partial<McpServerConfig>;
  const name = candidate.name?.trim();
  if (!name) {
    return { success: false, error: "MCP entry must include a non-empty name" };
  }

  const transport = candidate.transport ?? (candidate.url ? "http" : "stdio");
  if (transport !== "stdio" && transport !== "http" && transport !== "sse") {
    return { success: false, error: `Unsupported MCP transport: ${String(candidate.transport)}` };
  }

  if (transport === "stdio") {
    const command = candidate.command?.trim();
    if (!command) {
      return { success: false, error: `MCP server ${name} requires a command for stdio transport` };
    }

    return {
      success: true,
      config: {
        name,
        command,
        args: Array.isArray(candidate.args)
          ? candidate.args.filter((arg): arg is string => typeof arg === "string")
          : undefined,
        env: isStringRecord(candidate.env) ? candidate.env : undefined,
        transport,
      },
    };
  }

  const url = candidate.url?.trim();
  if (!url) {
    return { success: false, error: `MCP server ${name} requires a url for ${transport} transport` };
  }

  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return { success: false, error: `MCP server ${name} has an invalid url: ${url}` };
  }

  return {
    success: true,
    config: {
      name,
      command: candidate.command?.trim() || name,
      args: Array.isArray(candidate.args)
        ? candidate.args.filter((arg): arg is string => typeof arg === "string")
        : undefined,
      env: isStringRecord(candidate.env) ? candidate.env : undefined,
      transport,
      url,
    },
  };
}

function normalizeConfiguredMcpEntries(mcpServers: unknown): Array<{ name: string; value: unknown }> {
  if (Array.isArray(mcpServers)) {
    return mcpServers.map((value, index) => ({
      name: typeof (value as { name?: unknown } | undefined)?.name === "string"
        ? String((value as { name: string }).name)
        : `configured-mcp-${index + 1}`,
      value,
    }));
  }

  if (mcpServers && typeof mcpServers === "object") {
    return Object.entries(mcpServers as Record<string, unknown>).map(([name, value]) => ({ name, value }));
  }

  return [];
}

function readSkillFileMetadata(skillDir: string): SkillFileMetadata {
  const metadataPath = join(skillDir, "skill.json");
  if (!existsSync(metadataPath)) {
    return {};
  }

  try {
    const raw = JSON.parse(readFileSync(metadataPath, "utf-8")) as SkillFileMetadata;
    return {
      id: raw.id,
      name: raw.name,
      version: raw.version,
      description: raw.description,
      triggers: Array.isArray(raw.triggers)
        ? raw.triggers.filter((trigger): trigger is string => typeof trigger === "string")
        : undefined,
      requiredTools: Array.isArray(raw.requiredTools)
        ? raw.requiredTools.filter((tool): tool is string => typeof tool === "string")
        : undefined,
    };
  } catch {
    return {};
  }
}

function extractSkillNameFromMarkdown(content: string): string | null {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  return heading ? heading.slice(2).trim() : null;
}

function isExtension(value: unknown): value is Extension {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Extension>;
  return Boolean(
    candidate.metadata
      && typeof candidate.metadata.id === "string"
      && typeof candidate.metadata.name === "string"
      && typeof candidate.metadata.version === "string",
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";
}
