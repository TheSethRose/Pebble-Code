/**
 * Worktree flow support for parallel development contexts.
 * Post-MVP feature — interfaces defined for future implementation.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface WorktreeConfig {
  /** Base directory for worktrees */
  worktreeDir: string;
  /** Branch to create worktrees from */
  branch: string;
  /** Whether to auto-clean worktrees on exit */
  autoClean: boolean;
}

/**
 * Manage git worktrees for isolated development contexts.
 */
export class WorktreeManager {
  private worktrees: Map<string, string> = new Map();
  private config: WorktreeConfig;

  constructor(config: Partial<WorktreeConfig> = {}) {
    this.config = {
      worktreeDir: config.worktreeDir ?? ".pebble/worktrees",
      branch: config.branch ?? "main",
      autoClean: config.autoClean ?? true,
    };
    this.ensureDir();
  }

  /**
   * Create a new worktree for a session.
   */
  createWorktree(sessionId: string, branch?: string): string {
    const worktreePath = join(this.config.worktreeDir, sessionId);
    const targetBranch = branch ?? `${sessionId}-worktree`;

    if (existsSync(worktreePath)) {
      return worktreePath;
    }

    try {
      execSync(`git worktree add "${worktreePath}" -b ${targetBranch}`, {
        stdio: "pipe",
      });
      this.worktrees.set(sessionId, worktreePath);
      return worktreePath;
    } catch (error) {
      throw new Error(
        `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Remove a worktree.
   */
  removeWorktree(sessionId: string): void {
    const worktreePath = this.worktrees.get(sessionId);
    if (!worktreePath || !existsSync(worktreePath)) {
      return;
    }

    try {
      execSync(`git worktree remove "${worktreePath}"`, { stdio: "pipe" });
      this.worktrees.delete(sessionId);
    } catch (error) {
      console.error(`Failed to remove worktree: ${error}`);
    }
  }

  /**
   * Get worktree path for a session.
   */
  getWorktreePath(sessionId: string): string | undefined {
    return this.worktrees.get(sessionId);
  }

  /**
   * Clean all worktrees.
   */
  cleanAll(): void {
    for (const sessionId of this.worktrees.keys()) {
      this.removeWorktree(sessionId);
    }
  }

  private ensureDir(): void {
    if (!existsSync(this.config.worktreeDir)) {
      mkdirSync(this.config.worktreeDir, { recursive: true });
    }
  }
}
