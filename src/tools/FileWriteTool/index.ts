/**
 * FileWriteTool — creates or overwrites files directly.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const FileWriteInputSchema = z.object({
  file_path: z.string().describe("Absolute or relative path to the file"),
  content: z.string().describe("The full content to write to the file"),
  overwrite: z.boolean().optional().describe("Whether to overwrite an existing file (default: false)"),
  create_directories: z.boolean().optional().describe("Whether to create missing parent directories (default: true)"),
});

const SENSITIVE_PATH_HINTS = [".env", "package.json", "tsconfig.json", "prisma/schema"];

export class FileWriteTool implements Tool {
  name = "FileWrite";
  description = "Create a new file or overwrite an existing one with full contents. Use this when creating files from scratch instead of patching existing ones.";

  inputSchema = FileWriteInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = FileWriteInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const {
      file_path,
      content,
      overwrite = false,
      create_directories = true,
    } = parsed.data;

    const fullPath = resolvePath(file_path, context.cwd);
    const alreadyExists = existsSync(fullPath);

    if (alreadyExists && !overwrite) {
      return {
        success: false,
        output: "",
        error: `File already exists: ${fullPath}. Set overwrite=true to replace it.`,
      };
    }

    const parentDir = dirname(fullPath);
    if (!existsSync(parentDir)) {
      if (!create_directories) {
        return {
          success: false,
          output: "",
          error: `Parent directory does not exist: ${parentDir}`,
        };
      }
      mkdirSync(parentDir, { recursive: true });
    }

    try {
      writeFileSync(fullPath, content, "utf-8");
      return {
        success: true,
        output: `${alreadyExists ? "Overwrote" : "Created"} ${file_path}`,
        data: {
          filePath: file_path,
          fullPath,
          created: !alreadyExists,
          overwritten: alreadyExists,
          bytesWritten: Buffer.byteLength(content, "utf-8"),
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to write file: ${message}` };
    }
  }

  requiresApproval(input: unknown): boolean {
    const parsed = FileWriteInputSchema.safeParse(input);
    if (!parsed.success) {
      return true;
    }

    return parsed.data.overwrite === true
      || SENSITIVE_PATH_HINTS.some((hint) => parsed.data.file_path.includes(hint));
  }

  getApprovalMessage(input: unknown): string {
    const parsed = FileWriteInputSchema.safeParse(input);
    if (!parsed.success) {
      return "Allow FileWrite?";
    }

    const action = parsed.data.overwrite ? "overwrite" : "create";
    return `Allow FileWrite to ${action} ${parsed.data.file_path}?`;
  }
}

function resolvePath(filePath: string, cwd: string): string {
  return filePath.startsWith("/") ? filePath : resolve(cwd, filePath);
}