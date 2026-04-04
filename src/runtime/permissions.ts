import { z } from "zod";

/**
 * Permission modes control how the agent handles risky operations.
 */
export type PermissionMode =
  | "always-ask"    // prompt for every risky action
  | "auto-edit"     // auto-approve file edits, ask for bash
  | "auto-all"      // auto-approve all tools (headless default)
  | "restricted";   // deny all risky tools

/**
 * Trust level for the current working directory.
 */
export type TrustLevel =
  | "trusted"       // full access to project files and hooks
  | "untrusted"     // restricted access, no project-scoped behavior
  | "bare";         // minimal mode, bypass most dynamic loading

/**
 * Permission decision for a tool invocation.
 */
export type PermissionDecision =
  | "allow"
  | "deny"
  | "allow-session" // allow for this session only
  | "allow-always"; // persist the allow decision

/**
 * Context about the tool being requested.
 */
export interface PermissionContext {
  toolName: string;
  toolArgs: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high" | "critical";
  reason?: string;
}

/**
 * Result of a permission check.
 */
export interface PermissionResult {
  decision: PermissionDecision;
  persisted?: boolean;
  reason?: string;
}

/**
 * Trust configuration for a project.
 */
export interface TrustConfig {
  level: TrustLevel;
  projectRoot: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  hooksEnabled?: boolean;
  instructionsLoaded?: boolean;
}

/**
 * Schema for persisting permission decisions.
 */
export const PermissionDecisionSchema = z.object({
  toolName: z.string(),
  decision: z.enum(["allow-always", "deny-always"]),
  createdAt: z.string(),
  projectRoot: z.string(),
});

export type PersistedPermission = z.infer<typeof PermissionDecisionSchema>;
