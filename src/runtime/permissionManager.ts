import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PermissionContext,
  PermissionDecision,
  PermissionResult,
  PermissionMode,
  PersistedPermission,
} from "./permissions";

/**
 * Manages permission decisions with persistence support.
 */
export class PermissionManager {
  private mode: PermissionMode;
  private sessionAllows: Map<string, boolean> = new Map();
  private persistedDecisions: Map<string, PersistedPermission> = new Map();
  private permissionsFile: string;

  constructor(options: {
    mode?: PermissionMode;
    projectRoot: string;
  }) {
    this.mode = options.mode ?? "always-ask";
    this.permissionsFile = join(options.projectRoot, ".pebble-permissions.jsonl");
    this.loadPersistedDecisions();
  }

  /**
   * Check if a tool invocation is allowed.
   */
  async checkPermission(context: PermissionContext): Promise<PermissionResult> {
    // Auto-allow low-risk tools
    if (context.riskLevel === "low") {
      return { decision: "allow", reason: "Low risk tool auto-approved" };
    }

    // Check session allows
    if (this.sessionAllows.get(context.toolName)) {
      return { decision: "allow-session", reason: "Session allow" };
    }

    // Check persisted decisions
    const persisted = this.persistedDecisions.get(context.toolName);
    if (persisted) {
      if (persisted.decision === "allow-always") {
        return { decision: "allow-always", persisted: true, reason: "Persisted allow" };
      }
      if (persisted.decision === "deny-always") {
        return { decision: "deny", persisted: true, reason: "Persisted deny" };
      }
    }

    // Apply mode-based defaults
    switch (this.mode) {
      case "auto-all":
        return { decision: "allow", reason: "Auto-approve all (headless mode)" };
      case "auto-edit":
        if (context.toolName.includes("File")) {
          return { decision: "allow", reason: "Auto-approve file edits" };
        }
        break;
      case "restricted":
        return { decision: "deny", reason: "Restricted mode" };
    }

    // Default: ask user
    return { decision: "ask", reason: "Requires user approval" };
  }

  /**
   * Record a permission decision.
   */
  recordDecision(
    toolName: string,
    decision: PermissionDecision,
    persist: boolean = false,
  ): void {
    if (decision === "allow-session") {
      this.sessionAllows.set(toolName, true);
    }

    if (persist && (decision === "allow-always" || decision === "deny")) {
      const entry: PersistedPermission = {
        toolName,
        decision: decision === "allow-always" ? "allow-always" : "deny-always",
        createdAt: new Date().toISOString(),
        projectRoot: process.cwd(),
      };
      this.persistedDecisions.set(toolName, entry);
      appendFileSync(
        this.permissionsFile,
        JSON.stringify(entry) + "\n",
        "utf-8",
      );
    }
  }

  /**
   * Set the permission mode.
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * Get current mode.
   */
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * Clear session allows.
   */
  clearSessionAllows(): void {
    this.sessionAllows.clear();
  }

  /**
   * Get all persisted decisions.
   */
  getDecisions(): PersistedPermission[] {
    return Array.from(this.persistedDecisions.values());
  }

  /**
   * Reset all persisted decisions.
   */
  resetDecisions(): void {
    this.persistedDecisions.clear();
    if (existsSync(this.permissionsFile)) {
      writeFileSync(this.permissionsFile, "", "utf-8");
    }
  }

  private loadPersistedDecisions(): void {
    if (!existsSync(this.permissionsFile)) {
      return;
    }

    try {
      const content = readFileSync(this.permissionsFile, "utf-8");
      for (const line of content.split("\n").filter(Boolean)) {
        try {
          const entry = JSON.parse(line) as PersistedPermission;
          this.persistedDecisions.set(entry.toolName, entry);
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // ignore read errors
    }
  }
}
