/**
 * Tool registry — assembles and filters tools for the engine.
 */

import type { Tool } from "./Tool.js";

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool.
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools at once.
   */
  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names.
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Filter tools by allowed names.
   */
  filterByNames(allowedNames: string[]): Tool[] {
    return this.getAll().filter((t) => allowedNames.includes(t.name));
  }

  /**
   * Remove a tool from the registry.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all tools.
   */
  clear(): void {
    this.tools.clear();
  }
}
