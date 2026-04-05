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
import { summarizeShellExecution } from "../shared/outputCompaction.js";

const booleanish = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return value;
}, z.boolean());

const numberish = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return value;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number());

function numberField(description: string) {
  return numberish.describe(description);
}

function booleanField(description: string) {
  return booleanish.describe(description);
}

const WorkspaceReadInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read_file").describe("Read file contents when you already know the file path."),
    file_path: z.string().describe("File path to read. Prefer a repo-relative path like src/index.ts or an absolute path."),
    start_line: numberField("Optional 1-indexed start line. Pass a JSON number such as 1 when you want a partial read.").optional(),
    end_line: numberField("Optional 1-indexed inclusive end line. Pass a JSON number such as 200 when you want a partial read.").optional(),
  }),
  z.object({
    action: z.literal("list_directory").describe("List the immediate children of a directory, not a recursive tree."),
    path: z.string().optional().describe("Directory to inspect. Defaults to the current working directory."),
    include_hidden: booleanField("Whether to include dotfiles and hidden entries. Prefer a JSON boolean like true or false.").optional(),
    max_results: numberField("Optional maximum number of entries to return. Keep this small when you only need a quick sample.").optional(),
  }),
  z.object({
    action: z.literal("glob").describe("Find files by path pattern when you know the filename or folder shape."),
    pattern: z.string().describe("Glob pattern such as src/** or **/*.{ts,tsx}."),
    path: z.string().optional().describe("Optional directory to scope the glob search."),
    max_results: numberField("Optional maximum number of matching paths to return.").optional(),
  }),
  z.object({
    action: z.literal("grep").describe("Search file contents for exact text or a regex pattern."),
    pattern: z.string().describe("Text or regex pattern to search for."),
    path: z.string().optional().describe("Optional directory to search within."),
    include: z.string().optional().describe("Optional glob pattern to restrict matching files, such as src/**/*.ts."),
    is_regex: booleanField("Whether pattern should be treated as a regex.").optional(),
    case_sensitive: booleanField("Whether the search should be case-sensitive.").optional(),
    max_results: numberField("Optional maximum number of matches to return.").optional(),
  }),
  z.object({
    action: z.literal("project_structure").describe("Generate a recursive tree view for a folder when you need a quick structural overview."),
    path: z.string().optional().describe("Directory to render as a tree. Defaults to the current working directory."),
    max_depth: numberField("Optional recursion depth. Prefer a small JSON number such as 2 or 3 for an overview.").optional(),
    include_hidden: booleanField("Whether to include hidden files and directories in the tree.").optional(),
    max_entries_per_directory: numberField("Optional cap for how many children to include per directory before truncating.").optional(),
  }),
  z.object({
    action: z.literal("tool_search").describe("Search the available Pebble tools by name, alias, or category."),
    query: z.string().optional().describe("Optional text query to filter tools. Leave empty to list visible tools."),
    include_hidden: booleanField("Whether to include hidden/internal tools in the results.").optional(),
  }),
  z.object({
    action: z.literal("summarize_path").describe("Summarize a file or directory path with metadata and a short preview."),
    path: z.string().describe("Path to summarize."),
  }),
  z.object({
    action: z.literal("git_inspect").describe("Inspect repository status or diff information."),
    mode: z.enum(["status", "diff", "staged-diff", "changed-files"]).optional().describe("Git inspection mode. Defaults to status."),
  }),
  z.object({
    action: z.literal("diagnostics").describe("Run a common workspace verification command."),
    command: z.enum(["typecheck", "build", "test"]).optional().describe("Verification command to run. Defaults to typecheck."),
  }),
]);

export class WorkspaceReadTool implements Tool {
  name = "WorkspaceRead";
  aliases = ["WorkspaceInspect"];
  description = "Consolidated workspace inspection tool. Use this for ALL workspace read operations. Set the `action` field to choose the operation: `read_file` (file contents), `list_directory` (directory children), `glob` (find files by path pattern), `grep` (search file contents), `project_structure` (recursive tree view), `tool_search` (discover available tools), `summarize_path` (path metadata + preview), `git_inspect` (git status/diff), or `diagnostics` (run typecheck/build/test). IMPORTANT: Do NOT confuse this with the Shell tool — the Shell tool uses actions like `exec`, `start_background`, etc., while this tool ONLY accepts the read actions listed above. Always pass an object with an `action` field matching exactly one of the allowed literals. Several flags accept JSON-typed booleans/numbers as strings for model compatibility, but the action names themselves must still match exactly. Never send Shell, Bash, or background process actions here.";
  category = "workspace-read" as const;
  capability = "workspace-read" as const;
  inputSchema = WorkspaceReadInputSchema;

  normalizeInput(input: unknown, context: ToolContext): unknown {
    return normalizeWorkspaceReadInput(input, context);
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = WorkspaceReadInputSchema.safeParse(this.normalizeInput(input, context));
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
          truncated: result.truncated,
          data: result.data,
          debug: result.debug,
          summary: result.summary,
        };
      }

      case "diagnostics": {
        const command = parsed.data.command ?? "typecheck";
        const result = runWorkspaceCommand(command, context.cwd);
        return {
          success: result.success,
          output: result.output,
          error: result.error,
          truncated: result.truncated,
          data: {
            command,
            exitCode: result.exitCode,
            rawOutputPath: result.rawOutputPath,
          },
          debug: result.debug,
          summary: result.summary,
        };
      }
    }
  }
}

function normalizeWorkspaceReadInput(input: unknown, context: ToolContext): unknown {
  if (typeof input !== "string") {
    return input;
  }

  const trimmed = normalizeJsonText(input).trim();
  if (trimmed.length === 0) {
    return {
      action: "project_structure",
      path: ".",
    };
  }

  const resolvedPath = resolveWorkspacePath(trimmed, context.cwd);
  if (existsSync(resolvedPath)) {
    const stats = lstatSync(resolvedPath);
    if (stats.isDirectory()) {
      return {
        action: "project_structure",
        path: trimmed,
      };
    }

    return {
      action: "read_file",
      file_path: trimmed,
    };
  }

  return {
    action: "summarize_path",
    path: trimmed,
  };
}

function inspectGit(
  mode: "status" | "diff" | "staged-diff" | "changed-files",
  cwd: string,
): { output: string; data: Record<string, unknown>; summary: string; truncated: boolean; debug: Record<string, unknown>; rawOutputPath?: string } {
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
  const summarized = summarizeShellExecution({
    command: command.join(" "),
    stdout,
    stderr,
    exitCode: result.exitCode,
    cwd,
  });

  return {
    output: summarized.output,
    summary: summarized.summary,
    truncated: summarized.truncated,
    debug: summarized.debug,
    rawOutputPath: summarized.rawOutputPath,
    data: {
      mode,
      command,
      exitCode: result.exitCode,
      stdout,
      stderr,
      rawOutputPath: summarized.rawOutputPath,
    },
  };
}

function runWorkspaceCommand(
  command: "typecheck" | "build" | "test",
  cwd: string,
): { success: boolean; output: string; error?: string; exitCode: number; summary: string; truncated: boolean; debug: Record<string, unknown>; rawOutputPath?: string } {
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
  const summarized = summarizeShellExecution({
    command: cmd.join(" "),
    stdout,
    stderr,
    exitCode: result.exitCode,
    cwd,
  });

  return {
    success: result.exitCode === 0,
    output: summarized.output,
    error: result.exitCode === 0 ? undefined : `${command} failed with exit code ${result.exitCode}`,
    exitCode: result.exitCode,
    summary: summarized.summary,
    truncated: summarized.truncated,
    debug: summarized.debug,
    rawOutputPath: summarized.rawOutputPath,
  };
}
