/**
 * Stream event emission helpers.
 *
 * Centralizes the creation of StreamEvent objects
 * to ensure a consistent event contract.
 */

import type { StreamEvent } from "./types.js";

/**
 * Emit a stream event with the given type and data.
 */
export function emitStreamEvent(
  type: StreamEvent["type"],
  data: unknown
): StreamEvent {
  return {
    type,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Type guard: check if a value is a StreamEvent.
 */
export function isStreamEvent(value: unknown): value is StreamEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "data" in value &&
    "timestamp" in value
  );
}

/**
 * Valid event types for documentation/validation.
 */
export const EVENT_TYPES = [
  "text_delta",
  "tool_call",
  "tool_result",
  "progress",
  "error",
  "done",
  "retry",
  "permission_denied",
] as const;
