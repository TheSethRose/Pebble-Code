/**
 * Tool orchestration — assembles MVP tools and manages execution context.
 */

import type { Tool } from "./Tool.js";
import { IntegrationTool } from "./IntegrationTool/index.js";
import { MemoryTool } from "./MemoryTool/index.js";
import { NotebookTool } from "./NotebookTool/index.js";
import { OrchestrateTool } from "./OrchestrateTool/index.js";
import { ShellTool } from "./ShellTool/index.js";
import { UserInteractionTool } from "./UserInteractionTool/index.js";
import { WebTool } from "./WebTool/index.js";
import { WorkspaceEditTool } from "./WorkspaceEditTool/index.js";
import { WorkspaceReadTool } from "./WorkspaceReadTool/index.js";

/**
 * Create the default consolidated capability-tool surface.
 */
export function createMvpTools(extensionTools: Tool[] = []): Tool[] {
  const builtInTools = [
    new WorkspaceReadTool(),
    new WorkspaceEditTool(),
    new ShellTool(),
    new UserInteractionTool(),
    new MemoryTool(),
    new WebTool(),
    new NotebookTool(),
    new OrchestrateTool(),
    new IntegrationTool(),
  ];

  const mergedTools = new Map<string, Tool>();
  for (const tool of builtInTools) {
    mergedTools.set(tool.name, tool);
  }

  for (const tool of extensionTools) {
    mergedTools.set(tool.name, tool);
  }

  return Array.from(mergedTools.values());
}

/**
 * Get a summary of available tools.
 */
export function getToolSummary(tools: Tool[]): string {
  return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}
