import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SessionMemory } from "./memory.js";

/**
 * A single message in a transcript.
 */
export interface TranscriptMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    result?: string;
  };
}

/**
 * A session transcript with metadata.
 */
export interface SessionTranscript {
  id: string;
  messages: TranscriptMessage[];
  createdAt: string;
  updatedAt: string;
  status: "active" | "completed" | "error" | "interrupted";
  memory?: SessionMemory;
  metadata?: Record<string, unknown>;
}

/**
 * Session store for managing transcripts.
 */
export class SessionStore {
  private sessionsDir: string;

  constructor(sessionsDir: string = ".pebble/sessions") {
    this.sessionsDir = sessionsDir;
    this.ensureDir();
  }

  /**
   * Create a new session.
   */
  createSession(id?: string): SessionTranscript {
    const sessionId = id ?? this.generateId();
    const now = new Date().toISOString();
    const transcript: SessionTranscript = {
      id: sessionId,
      messages: [],
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    this.saveTranscript(transcript);
    return transcript;
  }

  /**
   * Append a message to a session.
   */
  appendMessage(sessionId: string, message: TranscriptMessage): void {
    const transcript = this.loadTranscript(sessionId);
    if (!transcript) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    transcript.messages.push(message);
    transcript.updatedAt = new Date().toISOString();
    this.saveTranscript(transcript);
  }

  /**
   * Load a session transcript.
   */
  loadTranscript(sessionId: string): SessionTranscript | null {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) {
      return null;
    }
    try {
      const content = readFileSync(path, "utf-8");
      return JSON.parse(content) as SessionTranscript;
    } catch {
      return null;
    }
  }

  /**
   * List all sessions.
   */
  listSessions(): Array<{ id: string; updatedAt: string; status: string; messageCount: number }> {
    if (!existsSync(this.sessionsDir)) {
      return [];
    }
    const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith(".json"));
    const sessions: Array<{ id: string; updatedAt: string; status: string; messageCount: number }> = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(this.sessionsDir, file), "utf-8");
        const transcript = JSON.parse(content) as SessionTranscript;
        sessions.push({
          id: transcript.id,
          updatedAt: transcript.updatedAt,
          status: transcript.status,
          messageCount: transcript.messages.length,
        });
      } catch {
        // skip corrupt files
      }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Get the most recent active session.
   */
  getLatestSession(): SessionTranscript | null {
    const sessions = this.listSessions();
    if (sessions.length === 0) {
      return null;
    }
    return this.loadTranscript(sessions[0]!.id);
  }

  /**
   * Fork a session.
   */
  forkSession(sessionId: string, newId?: string): SessionTranscript | null {
    const original = this.loadTranscript(sessionId);
    if (!original) {
      return null;
    }
    const forked: SessionTranscript = {
      ...original,
      id: newId ?? this.generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "active",
    };
    this.saveTranscript(forked);
    return forked;
  }

  /**
   * Update session status.
   */
  updateStatus(sessionId: string, status: SessionTranscript["status"]): void {
    const transcript = this.loadTranscript(sessionId);
    if (!transcript) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    transcript.status = status;
    transcript.updatedAt = new Date().toISOString();
    this.saveTranscript(transcript);
  }

  updateMemory(sessionId: string, memory: SessionMemory): SessionTranscript {
    const transcript = this.loadTranscript(sessionId);
    if (!transcript) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    transcript.memory = memory;
    transcript.updatedAt = new Date().toISOString();
    this.saveTranscript(transcript);
    return transcript;
  }

  clearMemory(sessionId: string): SessionTranscript {
    const transcript = this.loadTranscript(sessionId);
    if (!transcript) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    delete transcript.memory;
    transcript.updatedAt = new Date().toISOString();
    this.saveTranscript(transcript);
    return transcript;
  }

  private saveTranscript(transcript: SessionTranscript): void {
    const path = this.getSessionPath(transcript.id);
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(transcript, null, 2), "utf-8");
  }

  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  private generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }
}
