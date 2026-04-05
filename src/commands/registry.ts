import type { Command, CommandContext, CommandResult } from "./types";

/**
 * Registry for slash commands.
 */
export class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  /**
   * Register a command.
   */
  register(command: Command): void {
    this.commands.set(command.name.toLowerCase(), command);
    for (const alias of command.aliases ?? []) {
      this.commands.set(alias.toLowerCase(), command);
    }
  }

  /**
   * Register multiple commands at once.
   */
  registerMany(commands: Command[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }

  /**
   * Find a command by name or alias.
   */
  find(name: string): Command | undefined {
    return this.commands.get(name.toLowerCase());
  }

  /**
   * List all commands (deduplicated).
   */
  list(context?: CommandContext): Command[] {
    const seen = new Set<string>();
    const result: Command[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name) && this.isAvailable(cmd, context)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }

  /**
   * Execute a command by name.
   */
  async execute(
    name: string,
    args: string,
    context: CommandContext,
  ): Promise<CommandResult> {
    const cmd = this.find(name);
    if (!cmd) {
      return {
        success: false,
        output: `Unknown command: /${name}`,
      };
    }

    if (!this.isAvailable(cmd, context)) {
      return {
        success: false,
        output: `Command /${cmd.name} is not available in the current mode or trust level`,
      };
    }

    try {
      const result = await cmd.execute(args, context);
      return { success: true, output: result.output, exit: result.exit, data: result.data };
    } catch (error) {
      return {
        success: false,
        output: `Error executing /${name}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Check if input is a command.
   */
  isCommand(input: string, context?: CommandContext): boolean {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return false;
    const parts = trimmed.split(/\s+/);
    const name = parts[0]?.slice(1);
    if (!name) return false;
    const command = this.find(name);
    return command ? this.isAvailable(command, context) : false;
  }

  /**
   * Parse command input into name and args.
   */
  parseCommand(input: string): { name: string; args: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return null;
    const parts = trimmed.slice(1).split(/\s+/);
    return {
      name: parts[0]!,
      args: parts.slice(1).join(" "),
    };
  }

  private isAvailable(command: Command, context?: CommandContext): boolean {
    if (!context) {
      return true;
    }

    const currentMode = context.mode ?? (context.headless ? "headless" : "interactive");
    if (command.modes?.length && !command.modes.includes(currentMode)) {
      return false;
    }

    if (command.trustLevels?.length) {
      const trustLevel = context.trustLevel ?? "trusted";
      if (!command.trustLevels.includes(trustLevel)) {
        return false;
      }
    }

    return true;
  }
}
