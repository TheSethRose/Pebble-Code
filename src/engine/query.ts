/**
 * Query helper — convenience wrapper around QueryEngine.
 *
 * Provides a simple function interface for one-shot queries
 * without needing to instantiate the engine directly.
 */

import type { Provider } from "../providers/types.js";
import type { Tool } from "../tools/Tool.js";
import type { Message, StreamEvent } from "./types.js";
import { QueryEngine } from "./QueryEngine.js";
import type { PermissionManager } from "../runtime/permissionManager.js";
import type { AskUserQuestionRequest } from "./QueryEngine.js";

export interface QueryOptions {
  provider: Provider;
  tools?: Tool[];
  systemPrompt?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent?: (event: StreamEvent) => void;
  permissionManager?: PermissionManager;
  cwd?: string;
  resolveQuestion?: (request: AskUserQuestionRequest) => Promise<string>;
}

/**
 * Run a one-shot query and return the result.
 */
export async function query(
  messages: Message[],
  options: QueryOptions
) {
  const engine = new QueryEngine({
    provider: options.provider,
    tools: options.tools ?? [],
    systemPrompt: options.systemPrompt,
    maxTurns: options.maxTurns,
    signal: options.signal,
    onEvent: options.onEvent,
    permissionManager: options.permissionManager,
    cwd: options.cwd,
    resolveQuestion: options.resolveQuestion,
  });

  return engine.process(messages);
}

/**
 * Run a streaming query and yield events.
 */
export async function *streamQuery(
  messages: Message[],
  options: QueryOptions
) {
  const engine = new QueryEngine({
    provider: options.provider,
    tools: options.tools ?? [],
    systemPrompt: options.systemPrompt,
    maxTurns: options.maxTurns,
    signal: options.signal,
    onEvent: options.onEvent,
    permissionManager: options.permissionManager,
    cwd: options.cwd,
    resolveQuestion: options.resolveQuestion,
  });

  yield* engine.stream(messages);
}
