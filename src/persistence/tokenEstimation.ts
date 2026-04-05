import type { TranscriptMessage } from "./sessionStore.js";
import { buildMessageContentWithAttachments } from "../engine/messageAttachments.js";

/**
 * Estimate token count for a message list.
 * Rough approximation: ~4 chars per token.
 */
export function estimateTokens(messages: TranscriptMessage[]): number {
  return Math.ceil(
    messages.reduce(
      (sum, message) => sum + buildMessageContentWithAttachments(
        message.content,
        message.attachments,
        message.metadata,
      ).length,
      0,
    ) / 4,
  );
}