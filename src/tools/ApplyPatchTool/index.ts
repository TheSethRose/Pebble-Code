/**
 * ApplyPatchTool — applies unified diff patches across one or more files.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const ApplyPatchInputSchema = z.object({
  patch: z.string().describe("Unified diff patch content"),
});

interface ParsedFilePatch {
  oldPath: string | null;
  newPath: string | null;
  hunks: ParsedHunk[];
}

interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedHunkLine[];
  noNewlineAtEnd: boolean;
}

interface ParsedHunkLine {
  type: "context" | "add" | "remove";
  content: string;
}

interface FileBuffer {
  lines: string[];
  trailingNewline: boolean;
}

const SENSITIVE_PATH_HINTS = [".env", "package.json", "tsconfig.json", "prisma/schema"];

export class ApplyPatchTool implements Tool {
  name = "ApplyPatch";
  description = "Apply a unified diff patch across one or more files. Supports file creation, deletion, and in-place edits with hunk validation.";

  inputSchema = ApplyPatchInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = ApplyPatchInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    let filePatches: ParsedFilePatch[];
    try {
      filePatches = parseUnifiedDiff(parsed.data.patch);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Invalid patch: ${message}` };
    }

    if (filePatches.length === 0) {
      return { success: false, output: "", error: "Patch did not contain any file changes" };
    }

    const summaries: string[] = [];

    try {
      for (const filePatch of filePatches) {
        const summary = applyFilePatch(filePatch, context.cwd);
        summaries.push(summary);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to apply patch: ${message}` };
    }

    return {
      success: true,
      output: summaries.join("\n"),
      data: {
        filesChanged: filePatches.length,
        summaries,
      },
    };
  }

  requiresApproval(): boolean {
    return true;
  }

  getApprovalMessage(input: unknown): string {
    const parsed = ApplyPatchInputSchema.safeParse(input);
    if (!parsed.success) {
      return "Allow ApplyPatch?";
    }

    try {
      const filePatches = parseUnifiedDiff(parsed.data.patch);
      const touched = filePatches.map((filePatch) => filePatch.newPath ?? filePatch.oldPath).filter(Boolean) as string[];
      const sensitive = touched.some((path) => SENSITIVE_PATH_HINTS.some((hint) => path.includes(hint)));
      const preview = touched.slice(0, 3).join(", ");
      const suffix = touched.length > 3 ? ` (+${touched.length - 3} more)` : "";
      const prefix = sensitive ? "Apply sensitive patch" : "Apply patch";
      return `${prefix} to ${preview || "files"}${suffix}?`;
    } catch {
      return "Allow ApplyPatch?";
    }
  }
}

function parseUnifiedDiff(patchText: string): ParsedFilePatch[] {
  const lines = patchText.replace(/\r\n/g, "\n").split("\n");
  const files: ParsedFilePatch[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("new file mode") || line.startsWith("deleted file mode")) {
      index += 1;
      continue;
    }

    if (!line.startsWith("--- ")) {
      index += 1;
      continue;
    }

    const oldPath = normalizePatchPath(line.slice(4));
    index += 1;

    const nextLine = lines[index];
    if (!nextLine?.startsWith("+++ ")) {
      throw new Error("Expected +++ header after --- header");
    }

    const newPath = normalizePatchPath(nextLine.slice(4));
    index += 1;

    const hunks: ParsedHunk[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (current.startsWith("diff --git") || current.startsWith("--- ")) {
        break;
      }

      if (current.startsWith("index ") || current.startsWith("new file mode") || current.startsWith("deleted file mode")) {
        index += 1;
        continue;
      }

      if (!current.startsWith("@@ ")) {
        index += 1;
        continue;
      }

      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(current);
      if (!match) {
        throw new Error(`Invalid hunk header: ${current}`);
      }

      const hunk: ParsedHunk = {
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] ?? 1),
        lines: [],
        noNewlineAtEnd: false,
      };
      index += 1;

      while (index < lines.length) {
        const hunkLine = lines[index] ?? "";
        if (hunkLine.startsWith("@@ ") || hunkLine.startsWith("--- ") || hunkLine.startsWith("diff --git")) {
          break;
        }

        if (hunkLine === "\\ No newline at end of file") {
          hunk.noNewlineAtEnd = true;
          index += 1;
          continue;
        }

        const prefix = hunkLine[0];
        const content = hunkLine.slice(1);
        if (prefix === " ") {
          hunk.lines.push({ type: "context", content });
        } else if (prefix === "+") {
          hunk.lines.push({ type: "add", content });
        } else if (prefix === "-") {
          hunk.lines.push({ type: "remove", content });
        } else {
          throw new Error(`Unsupported patch line: ${hunkLine}`);
        }

        index += 1;
      }

      hunks.push(hunk);
    }

    files.push({ oldPath, newPath, hunks });
  }

  return files;
}

function normalizePatchPath(rawPath: string): string | null {
  const trimmed = rawPath.split("\t")[0]?.trim() ?? rawPath.trim();
  if (trimmed === "/dev/null") {
    return null;
  }

  const withoutQuotes = trimmed.replace(/^"|"$/g, "");
  if (withoutQuotes.startsWith("a/") || withoutQuotes.startsWith("b/")) {
    return withoutQuotes.slice(2);
  }

  return withoutQuotes;
}

function applyFilePatch(filePatch: ParsedFilePatch, cwd: string): string {
  const sourcePath = filePatch.oldPath ? resolve(cwd, filePatch.oldPath) : null;
  const targetPath = filePatch.newPath ? resolve(cwd, filePatch.newPath) : null;
  const sourceExisted = sourcePath ? existsSync(sourcePath) : false;

  if (!sourcePath && !targetPath) {
    throw new Error("Patch is missing both source and target file paths");
  }

  const original = readFileBuffer(sourcePath);
  const updated = applyHunks(original, filePatch.hunks, filePatch.oldPath ?? filePatch.newPath ?? "<unknown>");

  if (!targetPath) {
    if (sourcePath && existsSync(sourcePath)) {
      rmSync(sourcePath);
    }
    return `Deleted ${filePatch.oldPath}`;
  }

  const targetDir = dirname(targetPath);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  writeFileSync(targetPath, joinLines(updated.lines, updated.trailingNewline), "utf-8");

  if (sourcePath && targetPath !== sourcePath && existsSync(sourcePath)) {
    rmSync(sourcePath);
  }

  if (!sourceExisted) {
    return `Created ${filePatch.newPath}`;
  }

  if (filePatch.oldPath !== filePatch.newPath) {
    return `Renamed ${filePatch.oldPath} -> ${filePatch.newPath}`;
  }

  return `Patched ${filePatch.newPath}`;
}

function readFileBuffer(filePath: string | null): FileBuffer {
  if (!filePath) {
    return { lines: [], trailingNewline: true };
  }

  if (!existsSync(filePath)) {
    return { lines: [], trailingNewline: true };
  }

  const content = readFileSync(filePath, "utf-8");
  return splitLines(content);
}

function splitLines(content: string): FileBuffer {
  if (content.length === 0) {
    return { lines: [], trailingNewline: false };
  }

  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  return {
    lines: body.length === 0 ? [] : body.split("\n"),
    trailingNewline,
  };
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  if (lines.length === 0) {
    return trailingNewline ? "\n" : "";
  }

  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function applyHunks(buffer: FileBuffer, hunks: ParsedHunk[], fileLabel: string): FileBuffer {
  const lines = [...buffer.lines];
  let trailingNewline = buffer.trailingNewline;
  let offset = 0;

  for (const hunk of hunks) {
    const startIndex = Math.max(0, hunk.oldStart - 1 + offset);
    const replacement: string[] = [];
    let consumed = 0;

    for (const line of hunk.lines) {
      if (line.type === "context") {
        const original = lines[startIndex + consumed];
        if (original !== line.content) {
          throw new Error(`Context mismatch in ${fileLabel} at line ${hunk.oldStart}`);
        }
        replacement.push(line.content);
        consumed += 1;
        continue;
      }

      if (line.type === "remove") {
        const original = lines[startIndex + consumed];
        if (original !== line.content) {
          throw new Error(`Removal mismatch in ${fileLabel} at line ${hunk.oldStart}`);
        }
        consumed += 1;
        continue;
      }

      replacement.push(line.content);
    }

    lines.splice(startIndex, consumed, ...replacement);
    offset += replacement.length - consumed;

    if (hunk.noNewlineAtEnd) {
      trailingNewline = false;
    }
  }

  return { lines, trailingNewline };
}