/**
 * Tool orchestration — assembles MVP tools and manages execution context.
 */

import type { Tool } from "./Tool.js";
import { BashTool } from "./BashTool/index.js";
import { FileReadTool } from "./FileReadTool/index.js";
import { FileEditTool } from "./FileEditTool/index.js";
import { GlobTool } from "./GlobTool/index.js";
import { GrepTool } from "./GrepTool/index.js";
import { AskUserQuestionTool } from "./AskUserQuestionTool/index.js";
import { TodoTool } from "./TodoTool/index.js";
import { ToolRegistry } from "./registry.js";

/**
 * Create the default set of MVP tools.
 */
export function createMvpTools(): ToolRegistry {
  const registry = new ToolRegistry();

  const tools: Tool[] = [
    new BashTool(),
    new FileReadTool(),
    new FileEditTool(),
    new GlobTool(),
    new GrepTool(),
    new AskUserQuestionTool(),
    new TodoTool(),
  ];

  registry.registerMany(tools);
  return registry;
}

/**
 * Get a summary of available tools.
 */
export function getToolSummary(registry: ToolRegistry): string {
  const tools = registry.getAll();
  return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}
