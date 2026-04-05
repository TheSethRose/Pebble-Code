/**
 * Result envelope types for headless/SDK callers.
 *
 * These define the structured output format that headless
 * consumers can parse deterministically.
 */

/**
 * Create a result envelope for headless output.
 */
export function createResultEnvelope(
  status: "success" | "error" | "interrupted" | "max_turns" | "not_implemented",
  message: string,
  sessionId: string | null = null,
  data?: unknown
) {
  return {
    type: "result" as const,
    status,
    message,
    sessionId,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create a user replay event (echoing user input).
 */
export function createUserReplayEvent(text: string) {
  return {
    type: "user_replay" as const,
    text,
    timestamp: Date.now(),
  };
}

/**
 * Create a stream event wrapper.
 */
export function createStreamEvent(
  eventType: StreamEvent["type"],
  data: unknown
) {
  return {
    type: "stream_event" as const,
    event: eventType,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create a permission denial event.
 */
export function createPermissionDenialEvent(
  toolName: string,
  reason: string
) {
  return {
    type: "permission_denied" as const,
    tool: toolName,
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Create an init/session metadata event.
 */
export function createInitEvent(
  sessionId: string,
  model: string,
  provider: string,
  cwd: string
) {
  return {
    type: "init" as const,
    sessionId,
    model,
    provider,
    cwd,
    timestamp: Date.now(),
  };
}

import type { StreamEvent } from "./types.js";
