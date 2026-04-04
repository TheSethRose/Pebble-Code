/**
 * Tool orchestration — assembles MVP tools and manages execution context.
 */

import type { Tool } from "./Tool.js";
import { BashTool } from "./BashTool/index.js";
import { FileReadTool } from "./FileReadTool/index.js";
import { FileEditTool } from "./FileEditTool/index.js";
import { FileWriteTool } from "./FileWriteTool/index.js";
import { ApplyPatchTool } from "./ApplyPatchTool/index.js";
import { GlobTool } from "./GlobTool/index.js";
import { GrepTool } from "./GrepTool/index.js";
import { AskUserQuestionTool } from "./AskUserQuestionTool/index.js";
import { TodoTool } from "./TodoTool/index.js";

/**
 * Create the default set of MVP tools.
 */
export function createMvpTools(extensionTools: Tool[] = []): Tool[] {
  const builtInTools = [
    new BashTool(),
    new FileReadTool(),
    new FileEditTool(),
    new FileWriteTool(),
    new ApplyPatchTool(),
    new GlobTool(),
    new GrepTool(),
    new AskUserQuestionTool(),
    new TodoTool(),
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
