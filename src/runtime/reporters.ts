import type { Message, StreamEvent } from "../engine/types.js";
import {
  createInitEvent,
  createPermissionDenialEvent,
  createResultEnvelope,
  createStreamEvent,
  createUserReplayEvent,
  serializeSdkEvent,
} from "../engine/sdkProtocol.js";

export type HeadlessFormat = "text" | "json" | "json-stream";

export interface HeadlessReporter {
  readonly format: HeadlessFormat;
  emitInit(sessionId: string, providerModel: string, providerName: string, cwd: string): void;
  emitUserPrompt(prompt: string): void;
  emitStreamEvent(event: StreamEvent): void;
  emitReplayMessages(messages: Message[]): void;
  emitResult(
    status: "success" | "error" | "interrupted" | "max_turns" | "not_implemented",
    message: string,
    sessionId: string,
    data?: Record<string, unknown>,
  ): void;
  printText(messages: Message[], error?: string): void;
}

export function createHeadlessReporter(format: HeadlessFormat): HeadlessReporter {
  return {
    format,
    emitInit(sessionId, providerModel, providerName, cwd) {
      if (format !== "json-stream") {
        return;
      }

      console.log(serializeSdkEvent(createInitEvent(sessionId, providerModel, providerName, cwd)));
    },
    emitUserPrompt(prompt) {
      if (format !== "json-stream") {
        return;
      }

      console.log(serializeSdkEvent(createUserReplayEvent(prompt)));
    },
    emitStreamEvent(event) {
      if (format !== "json-stream") {
        return;
      }

      if (event.type === "permission_denied") {
        const data = (event.data ?? {}) as { tool?: string; reason?: string };
        console.log(serializeSdkEvent(createPermissionDenialEvent(data.tool ?? "unknown", data.reason ?? "Permission denied")));
        return;
      }

      console.log(serializeSdkEvent(createStreamEvent(event.type, event.data)));
    },
    emitReplayMessages(messages) {
      if (format !== "json-stream") {
        return;
      }

      for (const message of messages) {
        if (message.role === "assistant" && message.content.trim().length > 0) {
          console.log(serializeSdkEvent(createStreamEvent("text_delta", { delta: message.content })));
        }
      }
    },
    emitResult(status, message, sessionId, data) {
      const envelope = createResultEnvelope(status, message, sessionId, data);
      if (format === "json-stream") {
        console.log(serializeSdkEvent(envelope));
        return;
      }

      if (format === "json") {
        console.log(JSON.stringify(envelope));
      }
    },
    printText(messages, error) {
      if (format !== "text") {
        return;
      }

      const assistantText = messages
        .filter((message) => message.role === "assistant" && message.content.trim().length > 0)
        .map((message) => message.content.trim())
        .join("\n\n")
        .trim();

      if (assistantText.length > 0) {
        console.log(assistantText);
        return;
      }

      if (error) {
        console.log(error);
      }
    },
  };
}
