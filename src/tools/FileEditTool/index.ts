/**
 * FileEditTool — applies edits to existing files.
 * Uses a search-and-replace approach for surgical edits.
 */

import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const FileEditInputSchema = z.object({
  file_path: z.string().describe("Absolute or relative path to the file"),
  old_string: z.string().describe("The exact text to search for and replace"),
  new_string: z.string().describe("The text to replace old_string with"),
  expected_replacements: z.number().optional().describe("Expected number of replacements (default: 1)"),
});

export class FileEditTool implements Tool {
  name = "FileEdit";
  description = "Edit an existing file by searching for a specific string and replacing it. Use for making targeted changes to existing code. The old_string must match exactly including whitespace and indentation.";

  inputSchema = FileEditInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = FileEditInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const { file_path, old_string, new_string, expected_replacements = 1 } = parsed.data;
    const fullPath = file_path.startsWith("/") ? file_path : `${context.cwd}/${file_path}`;

    if (!existsSync(fullPath)) {
      return { success: false, output: "", error: `File not found: ${fullPath}` };
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const occurrences = content.split(old_string).length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          output: "",
          error: `old_string not found in file. The text must match exactly, including whitespace and indentation.`,
        };
      }

      if (occurrences !== expected_replacements) {
        return {
          success: false,
          output: "",
          error: `Found ${occurrences} occurrences of old_string, but expected ${expected_replacements}. Make old_string more specific or set expected_replacements to ${occurrences}.`,
        };
      }

      const newContent = content.replace(old_string, new_string);
      writeFileSync(fullPath, newContent, "utf-8");

      return {
        success: true,
        output: `Successfully replaced ${occurrences} occurrence(s) in ${file_path}`,
        data: { occurrences, filePath: file_path },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to edit file: ${message}` };
    }
  }

  requiresApproval(input: unknown): boolean {
    // File edits in sensitive directories should require approval
    const parsed = FileEditInputSchema.safeParse(input);
    if (!parsed.success) return true;

    const sensitivePaths = [".env", "package.json", "tsconfig.json", "prisma/schema"];
    return sensitivePaths.some((path) => parsed.data.file_path.includes(path));
  }
}
