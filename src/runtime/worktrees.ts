import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface WorktreeConfig {
  /** Git repository root the worktree commands should run against */
  repoRoot: string;
  /** Base directory for worktrees */
  worktreeDir: string;
  /** Branch to create worktrees from */
  branch: string;
  /** Whether to auto-clean worktrees on exit */
  autoClean: boolean;
  /** Optional state file path for persisted worktree metadata */
  stateFile: string;
}

export interface PersistedWorktreeRecord {
  sessionId: string;
  worktreePath: string;
  branch: string;
  createdAt: string;
}

interface PersistedWorktreeState {
  worktrees: PersistedWorktreeRecord[];
}

export interface WorktreeAvailability {
  available: boolean;
  repoRoot: string;
  worktreeDir: string;
  stateFile: string;
  gitRoot?: string;
  baseRef?: string;
  reason?: string;
}

export interface WorktreeCleanupOutcome {
  removedSessionIds: string[];
  retainedSessionIds: string[];
}

/**
 * Manage git worktrees for isolated development contexts.
 */
export class WorktreeManager {
  private worktrees: Map<string, PersistedWorktreeRecord> = new Map();
  private config: WorktreeConfig;

  constructor(config: Partial<WorktreeConfig> = {}) {
    const repoRoot = resolve(config.repoRoot ?? process.cwd());
    const worktreeDir = config.worktreeDir
      ? (isAbsolute(config.worktreeDir) ? config.worktreeDir : resolve(repoRoot, config.worktreeDir))
      : resolve(repoRoot, ".pebble", "worktrees");

    this.config = {
      repoRoot,
      worktreeDir,
      branch: config.branch ?? "main",
      autoClean: config.autoClean ?? true,
      stateFile: config.stateFile
        ? (isAbsolute(config.stateFile) ? config.stateFile : resolve(repoRoot, config.stateFile))
        : join(worktreeDir, "registry.json"),
    };
    this.ensureDir();
    this.loadState();
  }

  getAvailability(): WorktreeAvailability {
    const baseAvailability = {
      repoRoot: this.config.repoRoot,
      worktreeDir: this.config.worktreeDir,
      stateFile: this.config.stateFile,
    } satisfies Omit<WorktreeAvailability, "available">;

    try {
      const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: this.config.repoRoot,
        stdio: "pipe",
      }).toString("utf-8").trim();

      execFileSync("git", ["worktree", "list", "--porcelain"], {
        cwd: this.config.repoRoot,
        stdio: "pipe",
      });

      return {
        available: true,
        ...baseAvailability,
        gitRoot,
        baseRef: this.resolveBaseRef(),
      };
    } catch (error) {
      return {
        available: false,
        ...baseAvailability,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a new worktree for a session.
   */
  createWorktree(sessionId: string, branch?: string): string {
    const availability = this.getAvailability();
    if (!availability.available) {
      throw new Error(availability.reason ?? "Git worktrees are not available for this repository");
    }

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
      execFileSync("git", ["worktree", "add", "-b", targetBranch, worktreePath, this.resolveBaseRef()], {
        cwd: this.config.repoRoot,
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
      if (error instanceof Error && error.message.includes("already exists")) {
        try {
          execFileSync("git", ["worktree", "add", worktreePath, targetBranch], {
            cwd: this.config.repoRoot,
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
        } catch {
          // fall through to the wrapped error below
        }
      }

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
      execFileSync("git", ["worktree", "remove", worktree.worktreePath], {
        cwd: this.config.repoRoot,
        stdio: "pipe",
      });
      this.worktrees.delete(sessionId);
      this.saveState();
    } catch (error) {
      console.error(`Failed to remove worktree: ${error}`);
    }
  }

  getWorktree(sessionId: string): PersistedWorktreeRecord | undefined {
    const record = this.worktrees.get(sessionId);
    if (!record) {
      return undefined;
    }

    if (!existsSync(record.worktreePath)) {
      this.worktrees.delete(sessionId);
      this.saveState();
      return undefined;
    }

    return record;
  }

  /**
   * Get worktree path for a session.
   */
  getWorktreePath(sessionId: string): string | undefined {
    return this.getWorktree(sessionId)?.worktreePath;
  }

  /**
   * Clean all worktrees.
   */
  cleanAll(): void {
    for (const sessionId of this.worktrees.keys()) {
      this.removeWorktree(sessionId);
    }
  }

  pruneDeletedSessionWorktrees(activeSessionIds: Iterable<string>): WorktreeCleanupOutcome {
    const active = new Set(activeSessionIds);
    const removedSessionIds: string[] = [];
    const retainedSessionIds: string[] = [];

    for (const sessionId of Array.from(this.worktrees.keys())) {
      if (active.has(sessionId)) {
        retainedSessionIds.push(sessionId);
        continue;
      }

      this.removeWorktree(sessionId);
      if (this.worktrees.has(sessionId)) {
        retainedSessionIds.push(sessionId);
      } else {
        removedSessionIds.push(sessionId);
      }
    }

    return { removedSessionIds, retainedSessionIds };
  }

  private ensureDir(): void {
    if (!existsSync(this.config.worktreeDir)) {
      mkdirSync(this.config.worktreeDir, { recursive: true });
    }
  }

  private resolveBaseRef(): string {
    const preferred = this.config.branch.trim();
    if (preferred.length > 0) {
      try {
        execFileSync("git", ["rev-parse", "--verify", preferred], {
          cwd: this.config.repoRoot,
          stdio: "pipe",
        });
        return preferred;
      } catch {
        // Fall back to HEAD when the configured branch does not exist.
      }
    }

    return "HEAD";
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
