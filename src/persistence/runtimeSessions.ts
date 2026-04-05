import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "../engine/types.js";
import type { PermissionManager } from "../runtime/permissionManager.js";
import type { WorktreeStartupMode } from "../runtime/config.js";
import { findProjectRoot } from "../runtime/trust.js";
import { WorktreeManager, type WorktreeCleanupOutcome } from "../runtime/worktrees.js";
import { compactTranscriptWithArtifact, type CompactionArtifact } from "./compaction.js";
import { buildSessionMemory, isSessionMemoryStale } from "./memory.js";
import { SessionStore, type SessionTranscript, type TranscriptMessage } from "./sessionStore.js";
import type { DisplayMessage } from "../ui/types.js";
import { estimateTokens } from "./tokenEstimation.js";

/**
 * Runtime-facing session helpers that keep transcript persistence, session
 * memory, and worktree lifecycle in sync with the higher-level runtime boot.
 */

export interface SessionCompactionOutcome {
  transcript: SessionTranscript;
  compacted: boolean;
  previousMessageCount: number;
  nextMessageCount: number;
  artifact?: CompactionArtifact;
  reason: "threshold" | "manual";
}

export interface SessionDeletionOutcome {
  sessionDeleted: boolean;
  worktreeRemoved: boolean;
  worktreePath?: string;
}

interface SessionWorktreeMetadata {
  path: string;
  branch?: string;
  linkedAt?: string;
}

export function getSessionsDir(cwd: string): string {
  const projectRoot = findProjectRoot(cwd) ?? cwd;
  return join(projectRoot, ".pebble", "sessions");
}

export function createProjectSessionStore(cwd: string): SessionStore {
  return new SessionStore(getSessionsDir(cwd));
}

export function createOrResumeSession(
  store: SessionStore,
  requestedSessionId?: string,
): SessionTranscript {
  if (requestedSessionId) {
    return store.loadTranscript(requestedSessionId) ?? store.createSession(requestedSessionId);
  }

  return store.getLatestSession() ?? store.createSession();
}

/**
 * Resolves the startup session for interactive mode.
 *
 * `listSessions()` is newest-first, so `resume-linked` prefers the most recent
 * transcript whose recorded worktree still exists on disk.
 */
export function resolveInteractiveStartupSessionId(
  store: SessionStore,
  startupMode: WorktreeStartupMode | undefined,
  requestedSessionId?: string,
): string | null {
  if (requestedSessionId) {
    return requestedSessionId;
  }

  if (startupMode !== "resume-linked") {
    return null;
  }

  for (const summary of store.listSessions()) {
    const transcript = store.loadTranscript(summary.id);
    const linkedWorktree = getSessionWorktreeMetadata(transcript);
    if (transcript && linkedWorktree && existsSync(linkedWorktree.path)) {
      return transcript.id;
    }
  }

  return null;
}

export function cleanupDeletedSessionWorktrees(
  store: SessionStore,
  cwd: string,
): WorktreeCleanupOutcome {
  const projectRoot = findProjectRoot(cwd) ?? cwd;
  const manager = new WorktreeManager({ repoRoot: projectRoot });
  return manager.pruneDeletedSessionWorktrees(store.listSessions().map((session) => session.id));
}

export function deleteSessionWithRuntimeCleanup(
  store: SessionStore,
  cwd: string,
  sessionId: string,
): SessionDeletionOutcome {
  const transcript = store.loadTranscript(sessionId);
  const linkedWorktree = getSessionWorktreeMetadata(transcript);

  if (linkedWorktree) {
    const projectRoot = findProjectRoot(cwd) ?? cwd;
    const manager = new WorktreeManager({ repoRoot: projectRoot });
    manager.removeWorktree(sessionId);
  }

  return {
    sessionDeleted: store.deleteSession(sessionId),
    worktreeRemoved: linkedWorktree ? !existsSync(linkedWorktree.path) : false,
    ...(linkedWorktree ? { worktreePath: linkedWorktree.path } : {}),
  };
}

export function failPendingApprovalsForResume(
  store: SessionStore,
  permissionManager: PermissionManager,
  sessionId: string,
  reason = "Pending approval expired when the session was resumed.",
): TranscriptMessage[] {
  // Pending approvals are ephemeral UI state; when a session resumes without
  // resolving them, convert them into explicit transcript failures instead of
  // leaving hidden tool calls dangling.
  const failed = permissionManager.failPendingApprovalsForSession(sessionId, reason);
  const appended: TranscriptMessage[] = [];

  for (const pending of failed) {
    const message: TranscriptMessage = {
      role: "tool",
      content: `Tool execution denied: ${reason}`,
      timestamp: new Date().toISOString(),
      metadata: {
        success: false,
        error: reason,
        input: pending.toolArgs,
        toolCallId: pending.toolCallId,
        approvalMessage: pending.approvalMessage,
        canonicalToolName: pending.toolName,
      },
      toolCall: {
        name: pending.toolName,
        args: pending.toolArgs,
        result: `Tool execution denied: ${reason}`,
      },
    };

    store.appendMessage(sessionId, message);
    appended.push(message);
  }

  return appended;
}

export function compactSessionIfNeeded(
  store: SessionStore,
  sessionId: string,
  compactThreshold?: number,
): SessionTranscript | null {
  return compactSession(store, sessionId, {
    compactThreshold,
    force: false,
    reason: "threshold",
  })?.transcript ?? null;
}

export function compactSession(
  store: SessionStore,
  sessionId: string,
  options: {
    compactThreshold?: number;
    force?: boolean;
    reason?: "threshold" | "manual";
  } = {},
): SessionCompactionOutcome | null {
  const reason = options.reason ?? "threshold";

  const transcript = store.loadTranscript(sessionId);
  if (!transcript) {
    return null;
  }

  const previousMessageCount = transcript.messages.length;
  const shouldCompact = options.force === true
    || (options.compactThreshold !== undefined
      && options.compactThreshold > 0
      && estimateTokens(transcript.messages) >= options.compactThreshold);

  if (!shouldCompact) {
    return {
      transcript,
      compacted: false,
      previousMessageCount,
      nextMessageCount: previousMessageCount,
      reason,
    };
  }

  const result = compactTranscriptWithArtifact(transcript.messages);
  if (!result.compacted) {
    return {
      transcript,
      compacted: false,
      previousMessageCount,
      nextMessageCount: previousMessageCount,
      reason,
    };
  }

  const updatedTranscript = store.replaceMessages(sessionId, result.messages, {
    compactionCount: Number(transcript.metadata?.compactionCount ?? 0) + 1,
    lastCompactedAt: new Date().toISOString(),
    previousMessageCount: transcript.messages.length,
    compactThreshold: options.compactThreshold,
    lastCompactionReason: reason,
    lastCompactionArtifact: result.artifact,
  });

  return {
    transcript: updatedTranscript,
    compacted: true,
    previousMessageCount,
    nextMessageCount: updatedTranscript.messages.length,
    artifact: result.artifact,
    reason,
  };
}

export function ensureFreshSessionMemory(
  store: SessionStore,
  sessionId: string,
): SessionTranscript | null {
  const transcript = store.loadTranscript(sessionId);
  if (!transcript) {
    return null;
  }

  if (!isSessionMemoryStale(transcript.memory, transcript)) {
    return transcript;
  }

  return store.updateMemory(sessionId, buildSessionMemory(transcript));
}

export function transcriptToConversation(
  transcript: SessionTranscript,
  compactThreshold?: number,
): Message[] {
  // If a transcript has grown past the active threshold, compact the in-memory
  // view again before sending it to the provider. The stored transcript is
  // compacted separately so this function can remain a pure projection.
  const sourceMessages =
    compactThreshold && estimateTokens(transcript.messages) >= compactThreshold
      ? compactTranscriptWithArtifact(transcript.messages).messages
      : transcript.messages;

  const conversation = sourceMessages
    .filter((message) => isConversationRole(message.role))
    .map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.toolCall?.name ? { toolName: message.toolCall.name } : {}),
    }));

  if (transcript.memory) {
    // Session memory is injected as the first system message so the provider
    // sees the distilled recap before the replayed turn history.
    conversation.unshift({
      role: "system",
      content: buildSessionMemoryPrompt(transcript.memory.summary, transcript.memory.bullets),
    });
  }

  return conversation;
}

export function engineMessageToTranscriptMessage(message: Message): TranscriptMessage | null {
  if (!isConversationRole(message.role)) {
    return null;
  }

  const metadata = asRecord(message.metadata) ?? {};
  const toolArgs = asRecord(metadata.input) ?? {};

  return {
    role: message.role,
    content: message.content,
    timestamp: new Date().toISOString(),
    metadata,
    ...(message.toolName
      ? {
          toolCall: {
            name: message.toolName,
            args: toolArgs,
            result: message.content,
          },
        }
      : {}),
  };
}

export function transcriptToDisplayMessages(transcript: SessionTranscript): DisplayMessage[] {
  return transcript.messages.map((message) => {
    if (message.role !== "tool") {
      return {
        role: message.role,
        content: message.content,
      };
    }

    const metadata = asRecord(message.metadata);
    const explicitSuccess = typeof metadata?.success === "boolean" ? metadata.success : undefined;
    const isError = explicitSuccess === false
      || message.content.startsWith("Tool execution denied:")
      || message.content.startsWith("Tool execution error:")
      || message.content.startsWith("Unknown tool:");
    const toolName = message.toolCall?.name ?? "Tool";

    return {
      role: "tool_result",
      content: `${toolName} ${isError ? "failed" : "done"}`,
      meta: {
        toolName,
        toolArgs: message.toolCall?.args,
        toolOutput: message.content,
        isError,
        errorMessage: typeof metadata?.error === "string" ? metadata.error : undefined,
        toolCallId: typeof metadata?.toolCallId === "string" ? metadata.toolCallId : undefined,
        qualifiedToolName: typeof metadata?.qualifiedToolName === "string" ? metadata.qualifiedToolName : undefined,
        requestedToolName: typeof metadata?.requestedToolName === "string" ? metadata.requestedToolName : undefined,
        summary: typeof metadata?.summary === "string" ? metadata.summary : undefined,
        durationMs: typeof metadata?.durationMs === "number" ? metadata.durationMs : undefined,
        truncated: metadata?.truncated === true,
      },
    };
  });
}

function isConversationRole(role: TranscriptMessage["role"] | Message["role"]): role is "user" | "assistant" | "system" | "tool" {
  return role === "user" || role === "assistant" || role === "system" || role === "tool";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getSessionWorktreeMetadata(
  transcript: SessionTranscript | null | undefined,
): SessionWorktreeMetadata | null {
  const worktree = asRecord(transcript?.metadata?.worktree);
  const path = typeof worktree?.path === "string" ? worktree.path : "";
  if (!path) {
    return null;
  }

  return {
    path,
    ...(typeof worktree?.branch === "string" ? { branch: worktree.branch } : {}),
    ...(typeof worktree?.linkedAt === "string" ? { linkedAt: worktree.linkedAt } : {}),
  };
}

function buildSessionMemoryPrompt(summary: string, bullets: string[]): string {
  const sections = [
    "[Session memory]",
    summary.trim(),
  ];

  if (bullets.length > 0) {
    sections.push("Highlights:");
    sections.push(...bullets.map((bullet) => `- ${bullet}`));
  }

  return sections.join("\n\n");
}