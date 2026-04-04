import type { PebbleMood } from "./components/PebbleMascot.js";
import type { AppState, DisplayMessage } from "./types.js";

function hasSuccessfulReply(messages: readonly DisplayMessage[]): boolean {
  return messages.some((message) =>
    message.role === "assistant" || message.role === "output" || message.role === "tool_result",
  );
}

export function getPebbleMood(state: Pick<AppState, "messages" | "isProcessing" | "error">): PebbleMood {
  if (state.error) {
    return "sad";
  }

  if (state.isProcessing) {
    return "shocked";
  }

  if (state.messages.length === 0) {
    return "sleepy";
  }

  if (hasSuccessfulReply(state.messages)) {
    return "happy";
  }

  return "neutral";
}