import { join } from "node:path";
import type { Message } from "../engine/types.js";
import { findProjectRoot } from "../runtime/trust.js";
import { compactTranscript, estimateTokens } from "./compaction.js";
import { SessionStore, type SessionTranscript, type TranscriptMessage } from "./sessionStore.js";
import type { DisplayMessage } from "../ui/types.js";

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

export function compactSessionIfNeeded(
  store: SessionStore,
  sessionId: string,
  compactThreshold?: number,
): SessionTranscript | null {
  if (!compactThreshold || compactThreshold <= 0) {
    return store.loadTranscript(sessionId);
  }

  const transcript = store.loadTranscript(sessionId);
  if (!transcript) {
    return null;
  }

  if (estimateTokens(transcript.messages) < compactThreshold) {
    return transcript;
  }

  return store.replaceMessages(sessionId, compactTranscript(transcript.messages), {
    compactionCount: Number(transcript.metadata?.compactionCount ?? 0) + 1,
    lastCompactedAt: new Date().toISOString(),
    previousMessageCount: transcript.messages.length,
    compactThreshold,
  });
}

export function transcriptToConversation(
  transcript: SessionTranscript,
  compactThreshold?: number,
): Message[] {
  const sourceMessages =
    compactThreshold && estimateTokens(transcript.messages) >= compactThreshold
      ? compactTranscript(transcript.messages)
      : transcript.messages;

  return sourceMessages
    .filter((message) => isConversationRole(message.role))
    .map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.toolCall?.name ? { toolName: message.toolCall.name } : {}),
    }));
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