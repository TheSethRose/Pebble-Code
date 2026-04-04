/**
 * FileReadTool — reads file contents with optional line range.
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

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

    const { file_path, start_line = 1, end_line } = parsed.data;
    const fullPath = file_path.startsWith("/") ? file_path : `${context.cwd}/${file_path}`;

    if (!existsSync(fullPath)) {
      return { success: false, output: "", error: `File not found: ${fullPath}` };
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, start_line - 1);
      const end = end_line !== undefined ? end_line : lines.length;
      const selectedLines = lines.slice(start, end);
      let output = selectedLines.join("\n");

      const truncated = output.length > MAX_OUTPUT_CHARS;
      if (truncated) {
        output = output.slice(0, MAX_OUTPUT_CHARS) + "\n\n[Output truncated — use start_line/end_line to read specific ranges]";
      }

      return {
        success: true,
        output,
        truncated,
        data: { totalLines: lines.length, linesReturned: selectedLines.length },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to read file: ${message}` };
    }
  }
}
