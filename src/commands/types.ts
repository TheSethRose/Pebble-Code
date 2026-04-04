import type { SessionStore } from "../persistence/sessionStore.js";
import type { PermissionManager } from "../runtime/permissionManager.js";
import type { HookRegistry } from "../runtime/hooks.js";
import type { TrustLevel } from "../runtime/permissions.js";
import type { Tool } from "../tools/Tool.js";

/**
 * Command types for the slash-command system.
 */

/**
 * Command execution context.
 */
export interface CommandContext {
  /** Current working directory */
  cwd: string;
  /** Whether running in headless mode */
  headless: boolean;
  /** Current configuration */
  config: Record<string, unknown>;
  /** Active session store */
  sessionStore?: SessionStore;
  /** Active session id */
  sessionId?: string | null;
  /** Current trust level */
  trustLevel?: TrustLevel;
  /** Active permission manager */
  permissionManager?: PermissionManager;
  /** Loaded extension command names */
  extensionCommandNames?: string[];
  /** Loaded extension command implementations */
  extensionCommands?: Command[];
  /** Loaded extension tool implementations */
  extensionTools?: Tool[];
  /** Active hook registry populated from extensions */
  hookRegistry?: HookRegistry;
}

/**
 * Result from a command execution.
 */
export interface CommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Output to display to the user */
  output: string;
  /** Whether the command should exit the REPL */
  exit?: boolean;
  /** Structured data for the caller/UI */
  data?: Record<string, unknown>;
}

export type CommandMode = "interactive" | "headless";

/**
 * Command type determines how it's executed.
 */
export type CommandType =
  | "local" // Runs locally without sending to the model
  | "prompt" // Generates a prompt to send to the model
  | "ui"; // Purely UI interaction (no model or side effects)

/**
 * Command interface.
 */
export interface Command {
  /** Command name (without leading /) */
  name: string;
  /** Command description */
  description: string;
  /** Command type */
  type: CommandType;
  /** Command aliases */
  aliases?: string[];
  /** Modes where this command is available */
  modes?: CommandMode[];
  /** Trust levels where this command is available */
  trustLevels?: TrustLevel[];
  /** Usage string */
  usage?: string;
  /** Execute the command */
  execute(args: string, context: CommandContext): Promise<CommandResult> | CommandResult;
  /** Get usage help text */
  getHelp?(): string;
}
