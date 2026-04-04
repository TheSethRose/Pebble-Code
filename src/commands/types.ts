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
}

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
  /** Usage string */
  usage?: string;
  /** Execute the command */
  execute(args: string, context: CommandContext): Promise<CommandResult> | CommandResult;
  /** Get usage help text */
  getHelp?(): string;
}
