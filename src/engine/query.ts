/**
 * Query helper — convenience wrapper around QueryEngine.
 *
 * Provides a simple function interface for one-shot queries
 * without needing to instantiate the engine directly.
 */

import type { Message } from "./types.js";
import { QueryEngine, type QueryEngineOptions } from "./QueryEngine.js";

export type QueryOptions = Omit<QueryEngineOptions, "tools"> & {
  tools?: QueryEngineOptions["tools"];
};

function createQueryEngineFromOptions(options: QueryOptions): QueryEngine {
  return new QueryEngine({
    ...options,
    tools: options.tools ?? [],
  });
}

/**
 * Run a one-shot query and return the result.
 */
export async function query(
  messages: Message[],
  options: QueryOptions
) {
  const engine = createQueryEngineFromOptions(options);

  return engine.process(messages);
}

/**
 * Run a streaming query and yield events.
 */
export async function *streamQuery(
  messages: Message[],
  options: QueryOptions
) {
  const engine = createQueryEngineFromOptions(options);

  yield* engine.stream(messages);
}
