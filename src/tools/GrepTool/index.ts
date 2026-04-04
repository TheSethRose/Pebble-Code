/**
 * GrepTool — searches file contents using regex or literal strings.
 */

import { z } from "zod";
import { $ } from "bun";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const GrepInputSchema = z.object({
  pattern: z.string().describe("Search pattern (regex or literal string)"),
  path: z.string().optional().describe("File or directory to search in (defaults to context cwd)"),
  include: z.string().optional().describe("File glob to filter search (e.g., '*.ts')"),
  is_regex: z.boolean().optional().describe("Whether pattern is a regex (default: false)"),
  case_sensitive: z.boolean().optional().describe("Case sensitive search (default: false)"),
  max_results: z.number().optional().describe("Maximum number of results (default: 100)"),
});

const MAX_RESULTS = 200;

export class GrepTool implements Tool {
  name = "Grep";
  description = "Search file contents using a pattern. Use to find usages of a function, variable, or any text across the codebase. Faster than reading multiple files.";

  inputSchema = GrepInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = GrepInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const { pattern, path, include, is_regex = false, case_sensitive = false, max_results = 100 } = parsed.data;
    const searchPath = path ?? context.cwd;
    const limit = Math.min(max_results, MAX_RESULTS);

    try {
      // Build grep command
      let cmd = `grep -rn`;
      if (!case_sensitive) cmd += "i";
      if (!is_regex) cmd += "F"; // fixed string mode
      cmd += ` --color=never`;
      cmd += ` --no-messages`;
      if (include) cmd += ` --include='${include}'`;
      cmd += ` '${pattern.replace(/'/g, "'\\''")}'`;
      cmd += ` ${searchPath}`;

      const result = await $`bash -c ${cmd}`.quiet().nothrow();
      const output = String(result.stdout || "").trim();

      if (!output && result.exitCode !== 0) {
        return {
          success: true,
          output: `No matches found for "${pattern}" in ${searchPath}`,
          data: { matches: [], count: 0 },
        };
      }

      const lines = output.split("\n").slice(0, limit);
      const truncated = lines.length >= limit;
      const displayOutput = lines.join("\n") + (truncated ? `\n\n[Results truncated — showing first ${limit} matches]` : "");

      return {
        success: true,
        output: displayOutput,
        truncated,
        data: { matches: lines, count: lines.length },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Grep failed: ${message}` };
    }
  }
}
