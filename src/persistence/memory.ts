import { buildMessageSummaryArtifact } from "./summaryArtifacts.js";
import type { SessionTranscript, TranscriptMessage } from "./sessionStore.js";

export interface SessionMemory {
  kind: "session-memory";
  summary: string;
  bullets: string[];
  generatedAt: string;
  sourceMessageCount: number;
  tokenEstimate: number;
}

export function buildSessionMemory(
  transcript: Pick<SessionTranscript, "messages">,
): SessionMemory {
  const artifact = buildMessageSummaryArtifact(transcript.messages);

  return {
    kind: "session-memory",
    summary: artifact.summary,
    bullets: artifact.bullets,
    generatedAt: new Date().toISOString(),
    sourceMessageCount: artifact.sourceMessageCount,
    tokenEstimate: artifact.tokenEstimate,
  };
}

export function isSessionMemoryStale(
  memory: SessionMemory | undefined,
  transcript: Pick<SessionTranscript, "messages">,
): boolean {
  if (!memory) {
    return true;
  }

  return memory.sourceMessageCount !== transcript.messages.length;
}

export function formatSessionMemory(memory: SessionMemory, sessionId: string): string {
  return [
    `Session memory: ${sessionId}`,
    `Generated: ${memory.generatedAt}`,
    `Messages captured: ${memory.sourceMessageCount}`,
    `Estimated tokens: ${memory.tokenEstimate}`,
    "",
    "Summary:",
    memory.summary,
    "",
    "Highlights:",
    ...memory.bullets.map((bullet) => `- ${bullet}`),
  ].join("\n");
}