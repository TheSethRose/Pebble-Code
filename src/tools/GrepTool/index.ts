/**
 * GrepTool — searches file contents using regex or literal strings.
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";
import { compactGrepOutput } from "../shared/outputCompaction.js";

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

      const result = Bun.spawnSync({
        cmd: ["bash", "-lc", cmd],
        cwd: context.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = result.stdout.toString("utf-8").trim();

      if (!output && result.exitCode !== 0) {
        return {
          success: true,
          output: `No matches found for "${pattern}" in ${searchPath}`,
          summary: `Found 0 matches for ${pattern}`,
          data: { matches: [], count: 0 },
        };
      }

      const compacted = compactGrepOutput({
        rawOutput: output,
        maxResults: limit,
      });

      return {
        success: true,
        output: compacted.output,
        truncated: compacted.truncated,
        summary: compacted.summary,
        data: {
          matches: compacted.groups.flatMap((group) =>
            group.matches.map((match) => `${group.file}:${match.line}:${match.content}`),
          ),
          count: compacted.totalMatches,
          groups: compacted.groups,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Grep failed: ${message}` };
    }
  }
}
