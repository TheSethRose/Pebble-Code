import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface WorktreeConfig {
  /** Base directory for worktrees */
  worktreeDir: string;
  /** Branch to create worktrees from */
  branch: string;
  /** Whether to auto-clean worktrees on exit */
  autoClean: boolean;
  /** Optional state file path for persisted worktree metadata */
  stateFile: string;
}

interface PersistedWorktreeRecord {
  sessionId: string;
  worktreePath: string;
  branch: string;
  createdAt: string;
}

interface PersistedWorktreeState {
  worktrees: PersistedWorktreeRecord[];
}

/**
 * Manage git worktrees for isolated development contexts.
 */
export class WorktreeManager {
  private worktrees: Map<string, PersistedWorktreeRecord> = new Map();
  private config: WorktreeConfig;

  constructor(config: Partial<WorktreeConfig> = {}) {
    this.config = {
      worktreeDir: config.worktreeDir ?? ".pebble/worktrees",
      branch: config.branch ?? "main",
      autoClean: config.autoClean ?? true,
      stateFile: config.stateFile ?? join(config.worktreeDir ?? ".pebble/worktrees", "registry.json"),
    };
    this.ensureDir();
    this.loadState();
  }

  /**
   * Create a new worktree for a session.
   */
  createWorktree(sessionId: string, branch?: string): string {
    const existing = this.worktrees.get(sessionId);
    if (existing && existsSync(existing.worktreePath)) {
      return existing.worktreePath;
    }

    const worktreePath = join(this.config.worktreeDir, sessionId);
    const targetBranch = branch ?? existing?.branch ?? `${sessionId}-worktree`;

    if (existsSync(worktreePath)) {
      this.worktrees.set(sessionId, {
        sessionId,
        worktreePath,
        branch: targetBranch,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      this.saveState();
      return worktreePath;
    }

    try {
      execFileSync("git", ["worktree", "add", worktreePath, "-b", targetBranch], {
        stdio: "pipe",
      });
      this.worktrees.set(sessionId, {
        sessionId,
        worktreePath,
        branch: targetBranch,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      this.saveState();
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
    const worktree = this.worktrees.get(sessionId);
    if (!worktree) {
      return;
    }

    if (!existsSync(worktree.worktreePath)) {
      this.worktrees.delete(sessionId);
      this.saveState();
      return;
    }

    try {
      execFileSync("git", ["worktree", "remove", worktree.worktreePath], { stdio: "pipe" });
      this.worktrees.delete(sessionId);
      this.saveState();
    } catch (error) {
      console.error(`Failed to remove worktree: ${error}`);
    }
  }

  /**
   * Get worktree path for a session.
   */
  getWorktreePath(sessionId: string): string | undefined {
    const record = this.worktrees.get(sessionId);
    if (!record) {
      return undefined;
    }

    if (!existsSync(record.worktreePath)) {
      this.worktrees.delete(sessionId);
      this.saveState();
      return undefined;
    }

    return record.worktreePath;
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

  private loadState(): void {
    if (!existsSync(this.config.stateFile)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.config.stateFile, "utf-8")) as PersistedWorktreeState;
      for (const record of parsed.worktrees ?? []) {
        if (!record?.sessionId || !record.worktreePath || !record.branch) {
          continue;
        }

        if (existsSync(record.worktreePath)) {
          this.worktrees.set(record.sessionId, record);
        }
      }

      this.saveState();
    } catch {
      this.worktrees.clear();
    }
  }

  private saveState(): void {
    writeFileSync(
      this.config.stateFile,
      JSON.stringify(
        {
          worktrees: Array.from(this.worktrees.values()).sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
        } satisfies PersistedWorktreeState,
        null,
        2,
      ),
      "utf-8",
    );
  }
}
