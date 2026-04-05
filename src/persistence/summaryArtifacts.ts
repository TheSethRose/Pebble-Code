import type { TranscriptMessage } from "./sessionStore.js";
import { estimateTokens } from "./tokenEstimation.js";

export interface MessageSummaryArtifact {
  summary: string;
  bullets: string[];
  sourceMessageCount: number;
  tokenEstimate: number;
}

export function buildMessageSummaryArtifact(
  messages: TranscriptMessage[],
): MessageSummaryArtifact {
  const userSnippets = collectRecentSnippets(messages, "user", 3);
  const assistantSnippets = collectRecentSnippets(messages, "assistant", 2);
  const toolSnippets = collectRecentToolSnippets(messages, 3);

  const summaryParts: string[] = [];
  summaryParts.push(
    messages.length === 0
      ? "No conversation history has been recorded yet."
      : `Session contains ${messages.length} persisted message${messages.length === 1 ? "" : "s"}.`,
  );

  if (userSnippets.length > 0) {
    summaryParts.push(`Recent user focus: ${userSnippets.join("; ")}.`);
  }

  if (assistantSnippets.length > 0) {
    summaryParts.push(`Recent assistant work: ${assistantSnippets.join("; ")}.`);
  }

  if (toolSnippets.length > 0) {
    summaryParts.push(`Tools involved: ${toolSnippets.join(", ")}.`);
  }

  const bullets = [
    userSnippets.length > 0 ? `User: ${userSnippets.join(" · ")}` : "User: no user messages yet",
    assistantSnippets.length > 0
      ? `Assistant: ${assistantSnippets.join(" · ")}`
      : "Assistant: no assistant responses yet",
    toolSnippets.length > 0 ? `Tools: ${toolSnippets.join(", ")}` : "Tools: none recorded",
  ];

  return {
    summary: summaryParts.join(" "),
    bullets,
    sourceMessageCount: messages.length,
    tokenEstimate: estimateTokens(messages),
  };
}

function collectRecentSnippets(
  messages: TranscriptMessage[],
  role: TranscriptMessage["role"],
  limit: number,
): string[] {
  return messages
    .filter((message) => message.role === role)
    .slice(-limit)
    .map((message) => toSnippet(message.content))
    .filter((snippet, index, all) => snippet.length > 0 && all.indexOf(snippet) === index);
}

function collectRecentToolSnippets(
  messages: TranscriptMessage[],
  limit: number,
): string[] {
  return messages
    .filter((message) => message.role === "tool")
    .slice(-limit)
    .map((message) => message.toolCall?.name ?? toSnippet(message.content))
    .filter((snippet, index, all) => snippet.length > 0 && all.indexOf(snippet) === index);
}

function toSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77).trimEnd()}...`;
}