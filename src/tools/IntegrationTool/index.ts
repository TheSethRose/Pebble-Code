import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getDefaultExtensionDirs, loadExtensions } from "../../extensions/loaders.js";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const IntegrationInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list_extensions"),
  }),
  z.object({
    action: z.literal("load_extensions"),
  }),
  z.object({
    action: z.literal("list_skills"),
    path: z.string().optional(),
  }),
  z.object({
    action: z.literal("list_mcp_servers"),
  }),
]);

export class IntegrationTool implements Tool {
  name = "Integration";
  aliases = ["MCP", "Extensions", "Skills", "Plugins"];
  description = "Inspect and load extension, skill, and MCP-adjacent integration surfaces from one place.";
  category = "integration" as const;
  capability = "integration" as const;
  inputSchema = IntegrationInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = IntegrationInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    switch (parsed.data.action) {
      case "list_extensions": {
        const dirs = context.runtime?.extensionDirs ?? getDefaultExtensionDirs(context.cwd);
        const output = dirs.map((dir) => `${dir}\n${describeDirectory(dir)}`).join("\n\n");
        return {
          success: true,
          output,
          data: { dirs },
          summary: `Listed extension directories`,
        };
      }

      case "load_extensions": {
        const dirs = context.runtime?.extensionDirs ?? getDefaultExtensionDirs(context.cwd);
        const results = await loadExtensions(dirs);
        const output = results.map((result) => `${result.manifest.type}:${result.manifest.name} -> ${result.loaded ? "loaded" : result.error}`).join("\n");
        return {
          success: results.every((result) => result.loaded),
          output,
          data: { results },
          summary: `Loaded ${results.length} integration entries`,
        };
      }

      case "list_skills": {
        const searchRoot = parsed.data.path ?? context.cwd;
        const skills = findSkills(searchRoot);
        return {
          success: true,
          output: skills.length > 0 ? skills.join("\n") : "No local skills found.",
          data: { skills },
          summary: `Found ${skills.length} skills`,
        };
      }

      case "list_mcp_servers": {
        const settingsPath = join(context.cwd, ".pebble", "settings.json");
        if (!existsSync(settingsPath)) {
          return {
            success: true,
            output: "No settings file found for MCP inspection.",
            data: { mcpServers: [] },
          };
        }

        const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as { mcpServers?: unknown };
        const mcpServers = Array.isArray(settings.mcpServers) ? settings.mcpServers : [];
        return {
          success: true,
          output: mcpServers.length > 0 ? JSON.stringify(mcpServers, null, 2) : "No MCP servers configured.",
          data: { mcpServers },
          summary: `Found ${mcpServers.length} MCP server entries`,
        };
      }
    }
  }
}

function describeDirectory(dir: string): string {
  if (!existsSync(dir)) {
    return "(missing)";
  }

  const entries = readdirSync(dir).sort((left, right) => left.localeCompare(right));
  return entries.length > 0 ? entries.map((entry) => `- ${entry}`).join("\n") : "(empty)";
}

function findSkills(rootPath: string): string[] {
  const stack = [rootPath];
  const results: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) {
          stack.push(fullPath);
        }
        continue;
      }

      if (entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}
