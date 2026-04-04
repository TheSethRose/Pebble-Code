import { existsSync, lstatSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";
import { FileReadTool } from "../FileReadTool/index.js";
import { GlobTool } from "../GlobTool/index.js";
import { GrepTool } from "../GrepTool/index.js";
import {
  listDirectory,
  normalizeJsonText,
  renderProjectTree,
  resolveWorkspacePath,
  safePreviewText,
  truncateText,
} from "../shared/common.js";

const WorkspaceReadInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read_file"),
    file_path: z.string(),
    start_line: z.number().optional(),
    end_line: z.number().optional(),
  }),
  z.object({
    action: z.literal("list_directory"),
    path: z.string().optional(),
    include_hidden: z.boolean().optional(),
    max_results: z.number().optional(),
  }),
  z.object({
    action: z.literal("glob"),
    pattern: z.string(),
    path: z.string().optional(),
    max_results: z.number().optional(),
  }),
  z.object({
    action: z.literal("grep"),
    pattern: z.string(),
    path: z.string().optional(),
    include: z.string().optional(),
    is_regex: z.boolean().optional(),
    case_sensitive: z.boolean().optional(),
    max_results: z.number().optional(),
  }),
  z.object({
    action: z.literal("project_structure"),
    path: z.string().optional(),
    max_depth: z.number().optional(),
    include_hidden: z.boolean().optional(),
    max_entries_per_directory: z.number().optional(),
  }),
  z.object({
    action: z.literal("tool_search"),
    query: z.string().optional(),
    include_hidden: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("summarize_path"),
    path: z.string(),
  }),
  z.object({
    action: z.literal("git_inspect"),
    mode: z.enum(["status", "diff", "staged-diff", "changed-files"]).optional(),
  }),
  z.object({
    action: z.literal("diagnostics"),
    command: z.enum(["typecheck", "build", "test"]).optional(),
  }),
]);

export class WorkspaceReadTool implements Tool {
  name = "WorkspaceRead";
  aliases = [
    "FileRead",
    "ReadFile",
    "ListDirectory",
    "Glob",
    "Grep",
    "ToolSearch",
    "WorkspaceInspect",
  ];
  description = "Inspect the workspace through a single read surface for files, directories, glob/grep search, tool discovery, git inspection, diagnostics, and path summaries.";
  category = "workspace-read" as const;
  capability = "workspace-read" as const;
  inputSchema = WorkspaceReadInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = WorkspaceReadInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    switch (parsed.data.action) {
      case "read_file": {
        const fileRead = new FileReadTool();
        return fileRead.execute(parsed.data, context);
      }

      case "list_directory": {
        const targetPath = resolveWorkspacePath(parsed.data.path ?? ".", context.cwd);
        const entries = listDirectory(targetPath, {
          includeHidden: parsed.data.include_hidden,
          maxEntries: parsed.data.max_results,
        });
        const output = entries.length > 0 ? entries.join("\n") : `No entries in ${targetPath}`;
        return {
          success: true,
          output,
          data: {
            path: targetPath,
            entries,
            count: entries.length,
          },
          summary: `Listed ${entries.length} entries`,
        };
      }

      case "glob": {
        const globTool = new GlobTool();
        return globTool.execute(parsed.data, context);
      }

      case "grep": {
        const grepTool = new GrepTool();
        return grepTool.execute(parsed.data, context);
      }

      case "project_structure": {
        const targetPath = resolveWorkspacePath(parsed.data.path ?? context.cwd, context.cwd);
        const lines = renderProjectTree(targetPath, {
          maxDepth: parsed.data.max_depth,
          includeHidden: parsed.data.include_hidden,
          maxEntriesPerDirectory: parsed.data.max_entries_per_directory,
        });
        const preview = truncateText(lines.join("\n"), 20_000, "\n\n[Tree truncated]");
        return {
          success: true,
          output: preview.text,
          truncated: preview.truncated,
          data: { path: targetPath, lines },
          summary: `Generated project structure for ${targetPath}`,
        };
      }

      case "tool_search": {
        const registrations = context.runtime?.toolRegistry?.search(
          parsed.data.query ?? "",
          parsed.data.include_hidden,
        ) ?? [];
        const output = registrations.length > 0
          ? registrations.map((registration) => {
              const aliasText = registration.aliases.length > 0
                ? ` aliases: ${registration.aliases.join(", ")}`
                : "";
              return `${registration.canonicalName} [${registration.category}] <${registration.qualifiedName}>${aliasText}`;
            }).join("\n")
          : "No matching tools found.";

        return {
          success: true,
          output,
          data: {
            query: parsed.data.query ?? "",
            tools: registrations.map((registration) => ({
              name: registration.canonicalName,
              aliases: registration.aliases,
              category: registration.category,
              qualifiedName: registration.qualifiedName,
              hidden: registration.hidden,
            })),
          },
          summary: `Found ${registrations.length} tool matches`,
        };
      }

      case "summarize_path": {
        const targetPath = resolveWorkspacePath(parsed.data.path, context.cwd);
        if (!existsSync(targetPath)) {
          return { success: false, output: "", error: `Path not found: ${targetPath}` };
        }

        const stats = lstatSync(targetPath);
        const preview = safePreviewText(targetPath);
        const output = [
          `Path: ${targetPath}`,
          `Kind: ${stats.isDirectory() ? "directory" : preview.kind}`,
          `Bytes: ${stats.size}`,
          "",
          preview.preview,
        ].join("\n");

        return {
          success: true,
          output,
          truncated: preview.truncated,
          data: {
            path: targetPath,
            kind: stats.isDirectory() ? "directory" : preview.kind,
            size: stats.size,
            preview: preview.preview,
          },
          summary: `Summarized ${parsed.data.path}`,
        };
      }

      case "git_inspect": {
        const mode = parsed.data.mode ?? "status";
        const result = inspectGit(mode, context.cwd);
        return {
          success: true,
          output: result.output,
          data: result.data,
          summary: `Collected git ${mode}`,
        };
      }

      case "diagnostics": {
        const command = parsed.data.command ?? "typecheck";
        const result = runWorkspaceCommand(command, context.cwd);
        return {
          success: result.success,
          output: result.output,
          error: result.error,
          data: {
            command,
            exitCode: result.exitCode,
          },
          summary: `Ran ${command}`,
        };
      }
    }
  }
}

function inspectGit(
  mode: "status" | "diff" | "staged-diff" | "changed-files",
  cwd: string,
): { output: string; data: Record<string, unknown> } {
  const command = mode === "status"
    ? ["git", "status", "--short"]
    : mode === "diff"
      ? ["git", "diff", "--stat"]
      : mode === "staged-diff"
        ? ["git", "diff", "--cached", "--stat"]
        : ["git", "diff", "--name-only"];

  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = result.stdout.toString("utf-8").trim();
  const stderr = result.stderr.toString("utf-8").trim();
  const output = stdout || stderr || "No git output.";

  return {
    output,
    data: {
      mode,
      command,
      exitCode: result.exitCode,
      stdout,
      stderr,
    },
  };
}

function runWorkspaceCommand(
  command: "typecheck" | "build" | "test",
  cwd: string,
): { success: boolean; output: string; error?: string; exitCode: number } {
  const cmd = command === "typecheck"
    ? ["bun", "run", "typecheck"]
    : command === "build"
      ? ["bun", "run", "build"]
      : ["bun", "test"];

  const result = Bun.spawnSync({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString("utf-8").trim();
  const stderr = result.stderr.toString("utf-8").trim();
  const combined = [stdout, stderr].filter(Boolean).join("\n\n");
  const truncated = truncateText(combined || `${command} produced no output`, 20_000);

  return {
    success: result.exitCode === 0,
    output: truncated.text,
    error: result.exitCode === 0 ? undefined : `${command} failed with exit code ${result.exitCode}`,
    exitCode: result.exitCode,
  };
}
