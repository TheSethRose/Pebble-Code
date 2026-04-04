/**
 * Background session utilities for running agent tasks asynchronously.
 * Post-MVP feature — interfaces defined for future implementation.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface BackgroundSession {
  id: string;
  pid: number | null;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt: string;
  completedAt?: string;
  logFile: string;
}

/**
 * Manage background agent sessions.
 */
export class BackgroundSessionManager {
  private sessionsDir: string;
  private sessions: Map<string, BackgroundSession> = new Map();

  constructor(sessionsDir: string = ".pebble/background-sessions") {
    this.sessionsDir = sessionsDir;
    this.ensureDir();
    this.loadSessions();
  }

  /**
   * Start a background session with a given prompt.
   */
  startSession(sessionId: string, prompt: string): BackgroundSession {
    const logFile = join(this.sessionsDir, `${sessionId}.log`);
    const session: BackgroundSession = {
      id: sessionId,
      pid: null,
      status: "running",
      startedAt: new Date().toISOString(),
      logFile,
    };

    // Write session metadata
    this.saveSession(session);
    this.sessions.set(sessionId, session);

    // In a full implementation, this would spawn a pebble process
    // with --headless --prompt and capture output to the log file.
    // For now, we record the intent.
    writeFileSync(
      join(this.sessionsDir, `${sessionId}.prompt`),
      prompt,
      "utf-8",
    );

    return session;
  }

  /**
   * Get status of a background session.
   */
  getSession(sessionId: string): BackgroundSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all background sessions.
   */
  listSessions(): BackgroundSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Stop a background session.
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "stopped";
    session.completedAt = new Date().toISOString();
    this.saveSession(session);
  }

  /**
   * Get session output.
   */
  getOutput(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return "";

    if (existsSync(session.logFile)) {
      return readFileSync(session.logFile, "utf-8");
    }
    return "";
  }

  private saveSession(session: BackgroundSession): void {
    const metaPath = join(this.sessionsDir, `${session.id}.meta.json`);
    writeFileSync(metaPath, JSON.stringify(session, null, 2), "utf-8");
  }

  private loadSessions(): void {
    // Stub: would scan directory for .meta.json files
    // and load session metadata into the map.
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }
}
