import type { TranscriptMessage } from "./sessionStore.js";

/**
 * Estimate token count for a message list.
 * Rough approximation: ~4 chars per token.
 */
export function estimateTokens(messages: TranscriptMessage[]): number {
  return Math.ceil(
    messages.reduce((sum, message) => sum + message.content.length, 0) / 4,
  );
}