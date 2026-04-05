import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot } from "./trust.js";

export type VerificationCommand = "test" | "typecheck" | "build";
export type BackgroundRunTask = "agent" | "verification";
export type BackgroundRunStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface BackgroundRunRecord {
  id: string;
  task: BackgroundRunTask;
  status: BackgroundRunStatus;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  commands?: VerificationCommand[];
  sessionId?: string;
  parentSessionId?: string | null;
  initiatedBy?: string;
  logPath: string;
  recordPath: string;
  workerPid?: number;
  exitCode?: number;
  error?: string;
  summary?: string;
  stopRequestedAt?: string;
}

export interface BackgroundRunSummary {
  total: number;
  queued: number;
  running: number;
  active: number;
  completed: number;
  failed: number;
  stopped: number;
}

export interface StartBackgroundAgentRunOptions {
  prompt: string;
  sessionId?: string;
  parentSessionId?: string | null;
  provider?: string;
  model?: string;
  initiatedBy?: string;
}

export interface StartBackgroundVerificationRunOptions {
  commands: VerificationCommand[];
  parentSessionId?: string | null;
  initiatedBy?: string;
}

const WORKER_PATH = fileURLToPath(new URL("./backgroundRunWorker.ts", import.meta.url));

export function getBackgroundRunsDir(cwd: string): string {
  const projectRoot = findProjectRoot(cwd) ?? cwd;
  return join(projectRoot, ".pebble", "background-runs");
}

export function loadBackgroundRunRecord(recordPath: string): BackgroundRunRecord | null {
  if (!existsSync(recordPath)) {
    return null;
  }

  try {
    const raw = readFileSync(recordPath, "utf-8");
    const parsed = JSON.parse(raw) as BackgroundRunRecord;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBackgroundRunRecord(
  recordPath: string,
  record: BackgroundRunRecord,
): BackgroundRunRecord {
  ensureDir(dirname(recordPath));
  writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf-8");
  return record;
}

export function updateBackgroundRunRecord(
  recordPath: string,
  updater: (record: BackgroundRunRecord) => BackgroundRunRecord,
): BackgroundRunRecord {
  const current = loadBackgroundRunRecord(recordPath);
  if (!current) {
    throw new Error(`Background run record not found: ${recordPath}`);
  }

  const updated = updater(current);
  return saveBackgroundRunRecord(recordPath, updated);
}

export function appendBackgroundRunLog(logPath: string, line: string): void {
  ensureDir(dirname(logPath));
  appendFileSync(logPath, `${line}\n`, "utf-8");
}

export function appendBackgroundRunOutput(logPath: string, output: string): void {
  ensureDir(dirname(logPath));
  appendFileSync(logPath, output, "utf-8");
}

export function isBackgroundRunActive(status: BackgroundRunStatus): boolean {
  return status === "queued" || status === "running";
}

export function isProcessAlive(pid?: number): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class BackgroundRunManager {
  readonly projectRoot: string;
  private readonly runsDir: string;
  private readonly recordsDir: string;
  private readonly logsDir: string;

  constructor(cwd: string) {
    this.projectRoot = findProjectRoot(cwd) ?? cwd;
    this.runsDir = getBackgroundRunsDir(this.projectRoot);
    this.recordsDir = join(this.runsDir, "records");
    this.logsDir = join(this.runsDir, "logs");
    ensureDir(this.recordsDir);
    ensureDir(this.logsDir);
  }

  startAgentRun(options: StartBackgroundAgentRunOptions): BackgroundRunRecord {
    const id = createBackgroundRunId();
    const now = new Date().toISOString();
    const recordPath = this.getRecordPath(id);
    const logPath = this.getLogPath(id);
    const record: BackgroundRunRecord = {
      id,
      task: "agent",
      status: "queued",
      cwd: this.projectRoot,
      createdAt: now,
      updatedAt: now,
      prompt: options.prompt.trim(),
      provider: options.provider?.trim() || undefined,
      model: options.model?.trim() || undefined,
      sessionId: options.sessionId?.trim() || `background-session-${id}`,
      parentSessionId: options.parentSessionId ?? null,
      initiatedBy: options.initiatedBy,
      logPath,
      recordPath,
      summary: "Queued background agent run.",
    };

    saveBackgroundRunRecord(recordPath, record);
    const workerPid = this.spawnWorker(recordPath);

    return updateBackgroundRunRecord(recordPath, (current) => ({
      ...current,
      workerPid,
      updatedAt: new Date().toISOString(),
      summary: "Background agent run dispatched.",
    }));
  }

  startVerificationRun(options: StartBackgroundVerificationRunOptions): BackgroundRunRecord {
    const id = createBackgroundRunId();
    const now = new Date().toISOString();
    const recordPath = this.getRecordPath(id);
    const logPath = this.getLogPath(id);
    const record: BackgroundRunRecord = {
      id,
      task: "verification",
      status: "queued",
      cwd: this.projectRoot,
      createdAt: now,
      updatedAt: now,
      commands: options.commands,
      parentSessionId: options.parentSessionId ?? null,
      initiatedBy: options.initiatedBy,
      logPath,
      recordPath,
      summary: `Queued background verification (${options.commands.join(", ")}).`,
    };

    saveBackgroundRunRecord(recordPath, record);
    const workerPid = this.spawnWorker(recordPath);

    return updateBackgroundRunRecord(recordPath, (current) => ({
      ...current,
      workerPid,
      updatedAt: new Date().toISOString(),
      summary: "Background verification dispatched.",
    }));
  }

  getRun(runId: string): BackgroundRunRecord | null {
    const recordPath = this.getRecordPath(runId);
    const record = loadBackgroundRunRecord(recordPath);
    if (!record) {
      return null;
    }

    return this.reconcileRecord(record);
  }

  listRuns(): BackgroundRunRecord[] {
    if (!existsSync(this.recordsDir)) {
      return [];
    }

    return readdirSync(this.recordsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => loadBackgroundRunRecord(join(this.recordsDir, entry)))
      .filter((record): record is BackgroundRunRecord => Boolean(record))
      .map((record) => this.reconcileRecord(record))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  stopRun(runId: string): BackgroundRunRecord | null {
    const record = this.getRun(runId);
    if (!record) {
      return null;
    }

    if (!isBackgroundRunActive(record.status)) {
      return record;
    }

    const stopRequestedAt = new Date().toISOString();
    if (record.workerPid && isProcessAlive(record.workerPid)) {
      try {
        process.kill(record.workerPid, "SIGTERM");
      } catch {
        // Best-effort stop only.
      }
    }

    const updated = updateBackgroundRunRecord(record.recordPath, (current) => ({
      ...current,
      stopRequestedAt,
      updatedAt: stopRequestedAt,
      summary: "Stop requested.",
    }));

    appendBackgroundRunLog(updated.logPath, "[manager] Stop requested.");
    return this.reconcileRecord(updated);
  }

  getSummary(): BackgroundRunSummary {
    const runs = this.listRuns();
    const summary: BackgroundRunSummary = {
      total: runs.length,
      queued: 0,
      running: 0,
      active: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
    };

    for (const run of runs) {
      summary[run.status] += 1;
      if (isBackgroundRunActive(run.status)) {
        summary.active += 1;
      }
    }

    return summary;
  }

  private reconcileRecord(record: BackgroundRunRecord): BackgroundRunRecord {
    if (!isBackgroundRunActive(record.status)) {
      return record;
    }

    if (record.workerPid && isProcessAlive(record.workerPid)) {
      return record;
    }

    const finalizedAt = new Date().toISOString();
    const nextStatus: BackgroundRunStatus = record.stopRequestedAt ? "stopped" : "failed";
    return saveBackgroundRunRecord(record.recordPath, {
      ...record,
      status: nextStatus,
      finishedAt: record.finishedAt ?? finalizedAt,
      updatedAt: finalizedAt,
      summary: record.stopRequestedAt
        ? (record.summary ?? "Background run stopped.")
        : (record.summary ?? "Background run ended unexpectedly before completion metadata was written."),
      ...(nextStatus === "failed" && !record.error
        ? { error: "Background run ended unexpectedly before completion metadata was written." }
        : {}),
    });
  }

  private spawnWorker(recordPath: string): number {
    const child = spawn(
      process.execPath || "bun",
      ["run", WORKER_PATH, "--record", recordPath],
      {
        cwd: this.projectRoot,
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );
    child.unref();
    return child.pid ?? 0;
  }

  private getRecordPath(runId: string): string {
    return join(this.recordsDir, `${runId}.json`);
  }

  private getLogPath(runId: string): string {
    return join(this.logsDir, `${runId}.log`);
  }
}

function createBackgroundRunId(): string {
  return `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}