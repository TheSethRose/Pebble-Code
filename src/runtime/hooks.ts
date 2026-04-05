/**
 * Hook system for session lifecycle events.
 */

import type { Extension, ExtensionHookContext } from "../extensions/contracts.js";

export type HookEvent =
  | "session:start"
  | "session:end"
  | "session:compact:prepare"
  | "session:compact:before"
  | "session:compact:after"
  | "turn:before"
  | "turn:after"
  | "tool:before"
  | "tool:after"
  | "error";

export interface HookContext {
  sessionId?: string;
  turnCount?: number;
  toolName?: string;
  toolCallId?: string;
  toolInput?: unknown;
  toolSuccess?: boolean;
  error?: Error;
  tokenEstimate?: number;
  compactThreshold?: number;
  compactPrepareThreshold?: number;
  compactionReason?: string;
  compactionInstructions?: string;
  providerId?: string;
  model?: string;
  preparedOnly?: boolean;
}

export type HookHandler = (context: HookContext) => Promise<void> | void;

/**
 * Hook registry for session lifecycle events.
 */
export class HookRegistry {
  private hooks: Map<HookEvent, HookHandler[]> = new Map();

  /**
   * Register a hook handler for an event.
   */
  on(event: HookEvent, handler: HookHandler): void {
    const handlers = this.hooks.get(event) ?? [];
    handlers.push(handler);
    this.hooks.set(event, handlers);
  }

  /**
   * Fire all handlers for an event.
   */
  async fire(event: HookEvent, context: HookContext = {}): Promise<void> {
    const handlers = this.hooks.get(event) ?? [];
    for (const handler of handlers) {
      try {
        await handler(context);
      } catch (error) {
        // Isolate hook failures — don't break the session
        console.error(`Hook error for ${event}:`, error);
      }
    }
  }

  /**
   * Remove all handlers for an event.
   */
  clear(event?: HookEvent): void {
    if (event) {
      this.hooks.delete(event);
    } else {
      this.hooks.clear();
    }
  }
}

/**
 * Build a hook registry from loaded extensions.
 */
export function createHookRegistry(extensions: Extension[] = []): HookRegistry {
  const registry = new HookRegistry();

  for (const extension of extensions) {
    if (extension.hooks?.onSessionStart) {
      registry.on("session:start", (context) => extension.hooks?.onSessionStart?.(toExtensionHookContext(context)));
    }

    if (extension.hooks?.onSessionEnd) {
      registry.on("session:end", (context) => extension.hooks?.onSessionEnd?.(toExtensionHookContext(context)));
    }

    if (extension.hooks?.onBeforeTurn) {
      registry.on("turn:before", (context) => extension.hooks?.onBeforeTurn?.(toExtensionHookContext(context)));
    }

    if (extension.hooks?.onPreCompact) {
      registry.on("session:compact:prepare", (context) => extension.hooks?.onPreCompact?.(toExtensionHookContext(context)));
      registry.on("session:compact:before", (context) => extension.hooks?.onPreCompact?.(toExtensionHookContext(context)));
    }

    if (extension.hooks?.onPostCompact) {
      registry.on("session:compact:after", (context) => extension.hooks?.onPostCompact?.(toExtensionHookContext(context)));
    }

    if (extension.hooks?.onAfterTurn) {
      registry.on("turn:after", (context) => extension.hooks?.onAfterTurn?.(toExtensionHookContext(context)));
    }

    if (extension.hooks?.onBeforeTool) {
      registry.on("tool:before", (context) => extension.hooks?.onBeforeTool?.(toExtensionHookContext(context)));
    }

    if (extension.hooks?.onAfterTool) {
      registry.on("tool:after", (context) => extension.hooks?.onAfterTool?.(toExtensionHookContext(context)));
    }

    if (extension.hooks?.onError) {
      registry.on("error", (context) => extension.hooks?.onError?.(toExtensionHookContext(context)));
    }
  }

  return registry;
}

function toExtensionHookContext(context: HookContext): ExtensionHookContext {
  return {
    sessionId: context.sessionId,
    turnCount: context.turnCount,
    toolName: context.toolName,
    toolCallId: context.toolCallId,
    toolInput: context.toolInput,
    toolSuccess: context.toolSuccess,
    error: context.error,
    tokenEstimate: context.tokenEstimate,
    compactThreshold: context.compactThreshold,
    compactPrepareThreshold: context.compactPrepareThreshold,
    compactionReason: context.compactionReason,
    compactionInstructions: context.compactionInstructions,
    providerId: context.providerId,
    model: context.model,
    preparedOnly: context.preparedOnly,
  };
}
