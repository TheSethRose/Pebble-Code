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
  event: string;
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
    if (parsed && typeof parsed.type === "string") {
      return parsed as SdkEvent;
    }
    return null;
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

// Re-export factory functions for convenience
export {
  createResultEnvelope,
  createUserReplayEvent,
  createStreamEvent,
  createPermissionDenialEvent,
  createInitEvent,
};
