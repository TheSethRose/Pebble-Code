/**
 * BashTool — executes shell commands in a controlled environment.
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const BashInputSchema = z.object({
  command: z.string().describe("The shell command to execute"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
  cwd: z.string().optional().describe("Working directory (defaults to context cwd)"),
});

export class BashTool implements Tool {
  name = "Bash";
  description = "Execute a shell command and return its output. Use for running scripts, git commands, file operations, and other terminal tasks.";

  inputSchema = BashInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = BashInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        output: "",
        error: `Invalid input: ${parsed.error.message}`,
      };
    }

    const { command, timeout = 30000, cwd } = parsed.data;
    const workingDir = cwd ?? context.cwd;

    try {
      const result = await Bun.$`${command}`.cwd(workingDir).quiet();
      const stdout = String(result.stdout || "");
      const stderr = String(result.stderr || "");
      const output = stderr ? `${stdout}\n${stderr}`.trim() : stdout.trim();

      return {
        success: result.exitCode === 0,
        output: output || "(no output)",
        error: result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : undefined,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: "",
        error: `Command execution failed: ${message}`,
      };
    }
  }

  requiresApproval(input: unknown): boolean {
    const parsed = BashInputSchema.safeParse(input);
    if (!parsed.success) return true;

    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /mkfs/,
      /dd\s+if=/,
      /:\(\)\{\s*:\|:\s*&\s*\}\s*;/,
      /chmod\s+[0-7]*777\s+\/$/,
      />\s*\/dev\/sd/,
      /sudo\s+rm\s+-rf/,
    ];

    return dangerousPatterns.some((pattern) => pattern.test(parsed.data.command));
  }

  getApprovalMessage(input: unknown): string {
    const parsed = BashInputSchema.safeParse(input);
    if (!parsed.success) return "Execute shell command";
    return `Run command: ${parsed.data.command}`;
  }
}
