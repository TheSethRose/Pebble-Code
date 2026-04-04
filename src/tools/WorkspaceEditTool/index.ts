import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Tool, ToolApprovalRequest, ToolContext, ToolResult } from "../Tool.js";
import { ApplyPatchTool } from "../ApplyPatchTool/index.js";
import { FileEditTool } from "../FileEditTool/index.js";
import { FileWriteTool } from "../FileWriteTool/index.js";
import { resolveWorkspacePath } from "../shared/common.js";

const SensitivePathSchema = z.string();

const booleanish = z.preprocess((value) => {
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }

  return value;
}, z.boolean());

const numberish = z.preprocess((value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      const parsed = Number(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return value;
}, z.number());

const WorkspaceEditInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_directory"),
    path: z.string(),
  }),
  z.object({
    action: z.literal("write_file"),
    file_path: z.string(),
    content: z.string(),
    overwrite: booleanish.optional(),
    create_directories: booleanish.optional(),
  }),
  z.object({
    action: z.literal("edit_file"),
    file_path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    expected_replacements: numberish.optional(),
  }),
  z.object({
    action: z.literal("apply_patch"),
    patch: z.string(),
  }),
  z.object({
    action: z.literal("delete_path"),
    path: z.string(),
    recursive: booleanish.optional(),
  }),
  z.object({
    action: z.literal("move_path"),
    source_path: z.string(),
    destination_path: z.string(),
    overwrite: booleanish.optional(),
  }),
]);

const SENSITIVE_PATH_HINTS = [".env", "package.json", "tsconfig.json", "prisma/schema"];

export class WorkspaceEditTool implements Tool {
  name = "WorkspaceEdit";
  aliases = [
    "FileWrite",
    "CreateFile",
    "FileEdit",
    "ApplyPatch",
    "CreateDirectory",
    "DeletePath",
    "MovePath",
  ];
  description = "Mutate workspace files and directories through a single edit surface for creation, replacement, patching, deletion, and moves.";
  category = "workspace-edit" as const;
  capability = "workspace-edit" as const;
  inputSchema = WorkspaceEditInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = WorkspaceEditInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    switch (parsed.data.action) {
      case "create_directory": {
        const targetPath = resolveWorkspacePath(parsed.data.path, context.cwd);
        mkdirSync(targetPath, { recursive: true });
        return {
          success: true,
          output: `Created directory ${parsed.data.path}`,
          data: { path: targetPath },
          summary: `Created ${parsed.data.path}`,
        };
      }

      case "write_file": {
        const tool = new FileWriteTool();
        return tool.execute(parsed.data, context);
      }

      case "edit_file": {
        const tool = new FileEditTool();
        return tool.execute(parsed.data, context);
      }

      case "apply_patch": {
        const tool = new ApplyPatchTool();
        return tool.execute(parsed.data, context);
      }

      case "delete_path": {
        const targetPath = resolveWorkspacePath(parsed.data.path, context.cwd);
        if (!existsSync(targetPath)) {
          return { success: false, output: "", error: `Path not found: ${targetPath}` };
        }

        rmSync(targetPath, { recursive: parsed.data.recursive ?? true, force: true });
        return {
          success: true,
          output: `Deleted ${parsed.data.path}`,
          data: { path: targetPath },
          summary: `Deleted ${parsed.data.path}`,
        };
      }

      case "move_path": {
        const sourcePath = resolveWorkspacePath(parsed.data.source_path, context.cwd);
        const destinationPath = resolveWorkspacePath(parsed.data.destination_path, context.cwd);
        if (!existsSync(sourcePath)) {
          return { success: false, output: "", error: `Source path not found: ${sourcePath}` };
        }

        if (existsSync(destinationPath) && parsed.data.overwrite !== true) {
          return {
            success: false,
            output: "",
            error: `Destination already exists: ${destinationPath}. Set overwrite=true to replace it.`,
          };
        }

        mkdirSync(dirname(destinationPath), { recursive: true });
        if (existsSync(destinationPath) && parsed.data.overwrite === true) {
          rmSync(destinationPath, { recursive: true, force: true });
        }
        renameSync(sourcePath, destinationPath);

        return {
          success: true,
          output: `Moved ${parsed.data.source_path} -> ${parsed.data.destination_path}`,
          data: {
            sourcePath,
            destinationPath,
          },
          summary: `Moved ${parsed.data.source_path}`,
        };
      }
    }
  }

  buildApprovalRequest(input: unknown): ToolApprovalRequest | null {
    const parsed = WorkspaceEditInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        toolName: this.name,
        toolArgs: {},
        approvalMessage: "Allow WorkspaceEdit?",
        riskLevel: "high",
        resumable: true,
      };
    }

    switch (parsed.data.action) {
      case "create_directory": {
        return isSensitivePath(parsed.data.path)
          ? {
              toolName: this.name,
              toolArgs: { path: parsed.data.path },
              approvalMessage: `Allow creating directory ${parsed.data.path}?`,
              riskLevel: "medium",
              resumable: true,
            }
          : null;
      }

      case "write_file": {
        if (parsed.data.overwrite || isSensitivePath(parsed.data.file_path)) {
          return {
            toolName: this.name,
            toolArgs: {
              action: parsed.data.action,
              file_path: parsed.data.file_path,
              overwrite: parsed.data.overwrite ?? false,
            },
            approvalMessage: `Allow writing ${parsed.data.file_path}${parsed.data.overwrite ? " with overwrite" : ""}?`,
            riskLevel: parsed.data.overwrite ? "high" : "medium",
            resumable: true,
          };
        }
        return null;
      }

      case "edit_file": {
        return {
          toolName: this.name,
          toolArgs: {
            action: parsed.data.action,
            file_path: parsed.data.file_path,
            expected_replacements: parsed.data.expected_replacements ?? 1,
          },
          approvalMessage: `Allow editing ${parsed.data.file_path}?`,
          riskLevel: isSensitivePath(parsed.data.file_path) ? "high" : "medium",
          resumable: true,
        };
      }

      case "apply_patch": {
        return {
          toolName: this.name,
          toolArgs: { action: parsed.data.action },
          approvalMessage: "Allow applying patch to workspace files?",
          riskLevel: "high",
          resumable: true,
        };
      }

      case "delete_path": {
        return {
          toolName: this.name,
          toolArgs: {
            action: parsed.data.action,
            path: parsed.data.path,
            recursive: parsed.data.recursive ?? true,
          },
          approvalMessage: `Allow deleting ${parsed.data.path}?`,
          riskLevel: "critical",
          resumable: true,
        };
      }

      case "move_path": {
        return isSensitivePath(parsed.data.source_path) || isSensitivePath(parsed.data.destination_path)
          ? {
              toolName: this.name,
              toolArgs: {
                action: parsed.data.action,
                source_path: parsed.data.source_path,
                destination_path: parsed.data.destination_path,
              },
              approvalMessage: `Allow moving ${parsed.data.source_path} -> ${parsed.data.destination_path}?`,
              riskLevel: "high",
              resumable: true,
            }
          : null;
      }
    }
  }
}

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_HINTS.some((hint) => path.includes(hint));
}
