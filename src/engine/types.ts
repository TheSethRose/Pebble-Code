/**
 * Core engine message types.
 *
 * These define the canonical message model for the agent loop.
 */

/**
 * Role of a message participant.
 */
export type MessageRole =
  | "user"
  | "assistant"
  | "tool"
  | "system"
  | "progress";

/**
 * A single message in the conversation.
 */
export interface Message {
  /** Message role */
  role: MessageRole;
  /** Text content */
  content: string;
  /** Tool call ID (for tool result messages) */
  toolCallId?: string;
  /** Tool name (for tool result messages) */
  toolName?: string;
  /** Attachments (images, files, etc.) */
  attachments?: Attachment[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * An attachment to a message.
 */
export interface Attachment {
  type: "image" | "file" | "text";
  mimeType?: string;
  data: string | Uint8Array;
  name?: string;
}

/**
 * Terminal state of the engine.
 */
export type EngineState =
  | "idle"
  | "running"
  | "waiting_for_tool"
  | "waiting_for_user"
  | "success"
  | "error"
  | "interrupted"
  | "max_turns_reached";

/**
 * Event emitted during streaming.
 */
export interface StreamEvent {
  type:
    | "text_delta"
    | "tool_call"
    | "tool_result"
    | "progress"
    | "error"
    | "done"
    | "retry"
    | "permission_denied";
  data: unknown;
  timestamp: number;
}

/**
 * Result envelope for headless/SDK callers.
 */
export interface ResultEnvelope {
  type: "result";
  status: "success" | "error" | "interrupted" | "max_turns" | "not_implemented";
  message: string;
  sessionId: string | null;
  data?: unknown;
  timestamp: number;
}
