/**
 * Tool contract — the interface all tools must implement.
 */

import type { z } from "zod";

/**
 * Tool execution context.
 */
export interface ToolContext {
  /** Current working directory */
  cwd: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Permission mode for this tool */
  permissionMode: "always-ask" | "auto-edit" | "auto-all" | "restricted";
  /** Whether this is a dry run */
  dryRun?: boolean;
}

/**
 * Result from a tool execution.
 */
export interface ToolResult {
  /** Whether the tool succeeded */
  success: boolean;
  /** Text output (may be truncated) */
  output: string;
  /** Error message if failed */
  error?: string;
  /** Structured data result */
  data?: unknown;
  /** Whether output was truncated */
  truncated?: boolean;
}

/**
 * Tool interface.
 */
export interface Tool {
  /** Unique tool name */
  name: string;
  /** Tool description for the model */
  description: string;
  /** Zod schema for tool input */
  inputSchema: z.ZodType;
  /** Execute the tool */
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
  /** Whether this tool requires user approval */
  requiresApproval?(input: unknown): boolean;
  /** Get a human-readable summary of what the tool will do */
  getApprovalMessage?(input: unknown): string;
}
