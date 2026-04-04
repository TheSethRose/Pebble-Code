/**
 * Tool contract — the interface all tools must implement.
 */

import type { z } from "zod";
import type { SessionStore } from "../persistence/sessionStore.js";
import type { PermissionManager } from "../runtime/permissionManager.js";
import type { ToolRegistry } from "./registry.js";

export type ToolCategory =
  | "workspace-read"
  | "workspace-edit"
  | "shell"
  | "user-interaction"
  | "memory"
  | "web"
  | "notebook"
  | "orchestrate"
  | "integration"
  | "legacy"
  | (string & {});

export type ToolSource = "builtin" | "extension" | "skill" | "mcp" | (string & {});

export interface ToolProviderDefinitionContext {
  providerId?: string;
  model?: string;
}

export interface ToolProviderDefinitionOverride {
  providerId?: string;
  modelPattern?: RegExp;
  name?: string;
  description?: string;
  inputSchema?: z.ZodType | Record<string, unknown>;
  hidden?: boolean;
}

export interface ToolApprovalRequest {
  toolName: string;
  toolArgs: Record<string, unknown>;
  approvalMessage: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  resumable?: boolean;
  reason?: string;
}

export interface PendingToolApproval {
  id: string;
  sessionId: string;
  toolCallId?: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  approvalMessage: string;
  createdAt: string;
  status: "pending" | "resolved" | "failed";
  resolvedAt?: string;
  resolution?: string;
}

export interface ToolRuntimeContext {
  sessionId?: string | null;
  sessionStore?: SessionStore;
  permissionManager?: PermissionManager;
  toolRegistry?: ToolRegistry;
  extensionDirs?: string[];
}

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
  /** Runtime services that certain tools can opt into */
  runtime?: ToolRuntimeContext;
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
  /** Optional structured summary for UI/headless/debug consumers */
  summary?: string;
  /** Optional debug details that should not replace the main output */
  debug?: Record<string, unknown>;
}

/**
 * Tool interface.
 */
export interface Tool {
  /** Unique tool name */
  name: string;
  /** Alternate names that should resolve to this tool */
  aliases?: string[];
  /** Tool description for the model */
  description: string;
  /** Capability category for registry/search UI */
  category?: ToolCategory;
  /** Where the tool came from */
  source?: ToolSource;
  /** Optional source-local identifier (extension id, skill id, etc.) */
  sourceName?: string;
  /** Hide the tool from provider-facing definitions while still allowing alias resolution */
  hidden?: boolean;
  /** Optional capability-family label separate from the display name */
  capability?: string;
  /** Optional provider/model specific definition overrides */
  providerDefinitions?: ToolProviderDefinitionOverride[];
  /** Zod schema for tool input */
  inputSchema: z.ZodType;
  /** Execute the tool */
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
  /** Build a reusable approval request for risky actions */
  buildApprovalRequest?(input: unknown, context: ToolContext): ToolApprovalRequest | null;
  /** Whether this tool requires user approval */
  requiresApproval?(input: unknown): boolean;
  /** Get a human-readable summary of what the tool will do */
  getApprovalMessage?(input: unknown): string;
}
