import { join } from "node:path";
import type { Message } from "../engine/types.js";
import { findProjectRoot } from "../runtime/trust.js";
import { compactTranscript, estimateTokens } from "./compaction.js";
import { SessionStore, type SessionTranscript, type TranscriptMessage } from "./sessionStore.js";

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

  return {
    role: message.role,
    content: message.content,
    timestamp: new Date().toISOString(),
    ...(message.toolName
      ? {
          toolCall: {
            name: message.toolName,
            args: message.metadata ?? {},
          },
        }
      : {}),
  };
}

export function transcriptToDisplayMessages(transcript: SessionTranscript): Array<{ role: string; content: string }> {
  return transcript.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function isConversationRole(role: TranscriptMessage["role"] | Message["role"]): role is "user" | "assistant" | "system" | "tool" {
  return role === "user" || role === "assistant" || role === "system" || role === "tool";
}