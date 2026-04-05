/**
 * FileReadTool — reads file contents with optional line range.
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";
import { compactFileRead } from "../shared/outputCompaction.js";

const FileReadInputSchema = z.object({
  file_path: z.string().describe("Absolute or relative path to the file"),
  start_line: z.number().optional().describe("Start line (1-indexed, default: 1)"),
  end_line: z.number().optional().describe("End line (inclusive, default: end of file)"),
});

const MAX_OUTPUT_CHARS = 50000;

export class FileReadTool implements Tool {
  name = "FileRead";
  description = "Read the contents of a file. Supports reading the entire file or a specific line range. Use this to understand existing code before making changes.";

  inputSchema = FileReadInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = FileReadInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const { file_path, start_line, end_line } = parsed.data;
    const effectiveStartLine = start_line ?? 1;
    const fullPath = file_path.startsWith("/") ? file_path : `${context.cwd}/${file_path}`;

    if (!existsSync(fullPath)) {
      return { success: false, output: "", error: `File not found: ${fullPath}` };
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const compacted = compactFileRead({
        filePath: fullPath,
        content,
        startLine: start_line,
        endLine: end_line,
        maxChars: MAX_OUTPUT_CHARS,
      });
      const start = Math.max(0, effectiveStartLine - 1);
      const end = end_line !== undefined ? end_line : lines.length;
      const selectedLines = lines.slice(start, end);

      return {
        success: true,
        output: compacted.output,
        truncated: compacted.truncated,
        data: { totalLines: lines.length, linesReturned: selectedLines.length },
        debug: compacted.debug,
        summary: compacted.summary,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to read file: ${message}` };
    }
  }
}
