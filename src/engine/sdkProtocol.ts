/**
 * SDK Protocol — stable event contract for headless/SDK callers.
 *
 * This defines the wire format that external consumers can rely on
 * when integrating with Pebble Code programmatically.
 *
 * Events are emitted as NDJSON (newline-delimited JSON) over stdout,
 * with stderr reserved for human-readable logs.
 */

import type { StreamEvent } from "./types.js";
import {
  createResultEnvelope,
  createUserReplayEvent,
  createStreamEvent,
  createPermissionDenialEvent,
  createInitEvent,
} from "./results.js";

/**
 * All possible SDK event types.
 */
export type SdkEvent =
  | InitEvent
  | UserReplayEvent
  | StreamEventWrapper
  | PermissionDeniedEvent
  | ResultEvent;

const SDK_EVENT_TYPES = new Set<SdkEvent["type"]>([
  "init",
  "user_replay",
  "stream_event",
  "permission_denied",
  "result",
]);

const RESULT_STATUSES = new Set<ResultEvent["status"]>([
  "success",
  "error",
  "interrupted",
  "max_turns",
  "not_implemented",
]);

const STREAM_EVENT_TYPES = new Set<StreamEvent["type"]>([
  "text_delta",
  "tool_call",
  "tool_result",
  "progress",
  "error",
  "done",
  "permission_denied",
]);

export interface InitEvent {
  type: "init";
  sessionId: string;
  model: string;
  provider: string;
  cwd: string;
  timestamp: number;
}

export interface UserReplayEvent {
  type: "user_replay";
  text: string;
  timestamp: number;
}

export interface StreamEventWrapper {
  type: "stream_event";
  event: StreamEvent["type"];
  data: unknown;
  timestamp: number;
}

export interface PermissionDeniedEvent {
  type: "permission_denied";
  tool: string;
  reason: string;
  timestamp: number;
}

export interface ResultEvent {
  type: "result";
  status: "success" | "error" | "interrupted" | "max_turns" | "not_implemented";
  message: string;
  sessionId: string | null;
  data?: unknown;
  timestamp: number;
}

/**
 * Parse a line of NDJSON into an SDK event.
 * Returns null if the line is not valid JSON or not a recognized event.
 */
export function parseSdkEvent(line: string): SdkEvent | null {
  try {
    const parsed = JSON.parse(line);
    if (!isSdkEvent(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Serialize an SDK event to NDJSON.
 */
export function serializeSdkEvent(event: SdkEvent): string {
  return JSON.stringify(event);
}

function isSdkEvent(value: unknown): value is SdkEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SdkEvent> & Record<string, unknown>;
  if (typeof candidate.type !== "string" || !SDK_EVENT_TYPES.has(candidate.type as SdkEvent["type"])) {
    return false;
  }

  if (typeof candidate.timestamp !== "number") {
    return false;
  }

  switch (candidate.type) {
    case "init":
      return typeof candidate.sessionId === "string"
        && typeof candidate.model === "string"
        && typeof candidate.provider === "string"
        && typeof candidate.cwd === "string";
    case "user_replay":
      return typeof candidate.text === "string";
    case "stream_event":
      return typeof candidate.event === "string"
        && STREAM_EVENT_TYPES.has(candidate.event as StreamEvent["type"])
        && "data" in candidate;
    case "permission_denied":
      return typeof candidate.tool === "string"
        && typeof candidate.reason === "string";
    case "result":
      return typeof candidate.message === "string"
        && (candidate.sessionId === null || typeof candidate.sessionId === "string")
        && typeof candidate.status === "string"
        && RESULT_STATUSES.has(candidate.status as ResultEvent["status"]);
  }
}

// Re-export factory functions for convenience
export {
  createResultEnvelope,
  createUserReplayEvent,
  createStreamEvent,
  createPermissionDenialEvent,
  createInitEvent,
};
