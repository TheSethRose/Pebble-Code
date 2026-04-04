/**
 * Hook system for session lifecycle events.
 * Post-MVP feature — interfaces defined for future implementation.
 */

import type { Extension } from "../extensions/contracts.js";

export type HookEvent =
  | "session:start"
  | "session:end"
  | "turn:before"
  | "turn:after"
  | "tool:before"
  | "tool:after"
  | "error";

export interface HookContext {
  sessionId?: string;
  turnCount?: number;
  toolName?: string;
  error?: Error;
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
      registry.on("session:start", () => extension.hooks?.onSessionStart?.());
    }

    if (extension.hooks?.onSessionEnd) {
      registry.on("session:end", () => extension.hooks?.onSessionEnd?.());
    }

    if (extension.hooks?.onBeforeTurn) {
      registry.on("turn:before", () => extension.hooks?.onBeforeTurn?.());
    }

    if (extension.hooks?.onAfterTurn) {
      registry.on("turn:after", () => extension.hooks?.onAfterTurn?.());
    }
  }

  return registry;
}
