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
