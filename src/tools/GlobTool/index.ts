/**
 * GlobTool — finds files matching a glob pattern.
 */

import { z } from "zod";
import { Glob } from "bun";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const GlobInputSchema = z.object({
  pattern: z.string().describe("Glob pattern to match files against (e.g., '**/*.ts')"),
  path: z.string().optional().describe("Directory to search in (defaults to context cwd)"),
  max_results: z.number().optional().describe("Maximum number of results (default: 100)"),
});

const MAX_RESULTS = 500;

export class GlobTool implements Tool {
  name = "Glob";
  description = "Find files matching a glob pattern. Use to discover file locations, understand project structure, or find files of a specific type.";

  inputSchema = GlobInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = GlobInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const { pattern, path, max_results = 100 } = parsed.data;
    const searchPath = path ?? context.cwd;
    const limit = Math.min(max_results, MAX_RESULTS);

    try {
      const glob = new Glob(pattern);
      const matches: string[] = [];

      for await (const file of glob.scan(searchPath)) {
        matches.push(file);
        if (matches.length >= limit) break;
      }

      if (matches.length === 0) {
        return {
          success: true,
          output: `No files matched pattern "${pattern}" in ${searchPath}`,
          data: { files: [], count: 0 },
        };
      }

      const truncated = matches.length >= limit;
      const output = matches.join("\n") + (truncated ? `\n\n[Results truncated — ${limit} of potentially more matches]` : "");

      return {
        success: true,
        output,
        truncated,
        data: { files: matches, count: matches.length },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Glob failed: ${message}` };
    }
  }
}
