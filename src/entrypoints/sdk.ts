/**
 * Pebble Code SDK entrypoint.
 *
 * Provides a stable programmatic surface for embedding Pebble without
 * booting the CLI entrypoint directly.
 */

import { run, type HeadlessFormat, type RuntimeOptions } from "../runtime/main.js";
import { query, streamQuery, type QueryOptions } from "../engine/query.js";

export type { HeadlessFormat, RuntimeOptions, QueryOptions };
export { QueryEngine, type QueryEngineOptions, type QueryResult } from "../engine/QueryEngine.js";
export { query, streamQuery };
export type { Message, StreamEvent, ResultEnvelope } from "../engine/types.js";
export * from "../engine/sdkProtocol.js";

/**
 * Run Pebble programmatically using the same runtime boot path as the CLI.
 */
export async function runSdk(options: RuntimeOptions = {}): Promise<number> {
  return run(options);
}

/**
 * Convenience helper for deterministic, non-interactive execution.
 */
export async function runHeadless(
  options: Omit<RuntimeOptions, "headless"> & {
    prompt: string;
    format?: HeadlessFormat;
  },
): Promise<number> {
  return run({
    ...options,
    headless: true,
  });
}