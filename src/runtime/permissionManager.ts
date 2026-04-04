import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PermissionContext,
  PermissionDecision,
  PermissionResult,
  PermissionMode,
  PersistedPermission,
  PersistedPendingApproval,
} from "./permissions";

/**
 * Manages permission decisions with persistence support.
 */
export class PermissionManager {
  private mode: PermissionMode;
  private readonly projectRoot: string;
  private readonly sessionAllows: Map<string, boolean> = new Map();
  private readonly persistedDecisions: Map<string, PersistedPermission> = new Map();
  private readonly pendingApprovals: Map<string, PersistedPendingApproval> = new Map();
  private readonly permissionsFile: string;
  private readonly pendingApprovalsFile: string;

  constructor(options: {
    mode?: PermissionMode;
    projectRoot: string;
  }) {
    this.mode = options.mode ?? "always-ask";
    this.projectRoot = options.projectRoot;
    this.permissionsFile = join(options.projectRoot, ".pebble-permissions.jsonl");
    this.pendingApprovalsFile = join(options.projectRoot, ".pebble", "pending-approvals.json");
    this.loadPersistedDecisions();
    this.loadPendingApprovals();
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
        if (context.toolName.includes("File") || context.toolName === "ApplyPatch") {
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
        projectRoot: this.projectRoot,
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

  createPendingApproval(request: {
    sessionId?: string | null;
    toolCallId?: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    approvalMessage: string;
  }): PersistedPendingApproval | null {
    if (!request.sessionId) {
      return null;
    }

    const pending: PersistedPendingApproval = {
      id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: request.sessionId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      toolArgs: request.toolArgs,
      approvalMessage: request.approvalMessage,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    this.pendingApprovals.set(pending.id, pending);
    this.savePendingApprovals();
    return pending;
  }

  resolvePendingApproval(id: string, resolution: PermissionDecision | string): PersistedPendingApproval | null {
    const pending = this.pendingApprovals.get(id);
    if (!pending) {
      return null;
    }

    pending.status = "resolved";
    pending.resolution = resolution;
    pending.resolvedAt = new Date().toISOString();
    this.savePendingApprovals();
    return pending;
  }

  failPendingApprovalsForSession(sessionId: string, reason: string): PersistedPendingApproval[] {
    const failed = Array.from(this.pendingApprovals.values())
      .filter((pending) => pending.sessionId === sessionId && pending.status === "pending")
      .map((pending) => {
        pending.status = "failed";
        pending.resolution = reason;
        pending.resolvedAt = new Date().toISOString();
        return { ...pending };
      });

    if (failed.length > 0) {
      this.savePendingApprovals();
    }

    return failed;
  }

  getPendingApprovals(sessionId?: string): PersistedPendingApproval[] {
    return Array.from(this.pendingApprovals.values())
      .filter((pending) => pending.status === "pending")
      .filter((pending) => !sessionId || pending.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  /**
   * Reset all persisted decisions.
   */
  resetDecisions(): void {
    this.persistedDecisions.clear();
    if (existsSync(this.permissionsFile)) {
      writeFileSync(this.permissionsFile, "", "utf-8");
    }

    this.pendingApprovals.clear();
    if (existsSync(this.pendingApprovalsFile)) {
      writeFileSync(this.pendingApprovalsFile, "[]", "utf-8");
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

  private loadPendingApprovals(): void {
    if (!existsSync(this.pendingApprovalsFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.pendingApprovalsFile, "utf-8");
      const parsed = JSON.parse(raw) as PersistedPendingApproval[];
      for (const entry of parsed) {
        if (entry && typeof entry.id === "string") {
          this.pendingApprovals.set(entry.id, entry);
        }
      }
    } catch {
      // ignore read errors
    }
  }

  private savePendingApprovals(): void {
    const dir = join(this.projectRoot, ".pebble");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(
      this.pendingApprovalsFile,
      JSON.stringify(Array.from(this.pendingApprovals.values()), null, 2),
      "utf-8",
    );
  }
}
