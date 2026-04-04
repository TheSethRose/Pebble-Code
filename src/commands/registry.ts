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
   * Find a command by name or alias.
   */
  find(name: string): Command | undefined {
    return this.commands.get(name.toLowerCase());
  }

  /**
   * List all commands (deduplicated).
   */
  list(): Command[] {
    const seen = new Set<string>();
    const result: Command[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
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

    try {
      const result = await cmd.execute(args, context);
      return { success: true, output: result.output };
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
  isCommand(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return false;
    const parts = trimmed.split(/\s+/);
    const name = parts[0]?.slice(1);
    return name ? this.commands.has(name.toLowerCase()) : false;
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
}
