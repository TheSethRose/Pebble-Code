import { extname } from "node:path";
import { truncateText } from "../common.js";
import { DATA_FILE_EXTENSIONS, SOURCE_FILE_EXTENSIONS } from "./shared.js";

export function compactFileRead(params: {
  filePath: string;
  content: string;
  startLine?: number;
  endLine?: number;
  maxChars: number;
}): {
  output: string;
  truncated: boolean;
  summary?: string;
  debug?: Record<string, unknown>;
} {
  const lines = params.content.split("\n");
  const start = Math.max(0, (params.startLine ?? 1) - 1);
  const end = params.endLine !== undefined ? Math.min(lines.length, params.endLine) : lines.length;
  const selectedLines = lines.slice(start, end);
  const selectedContent = selectedLines.join("\n");
  const extension = extname(params.filePath).toLowerCase();
  const isLineWindow = params.startLine !== undefined || params.endLine !== undefined;
  const isDataFile = DATA_FILE_EXTENSIONS.has(extension);
  const isSourceFile = SOURCE_FILE_EXTENSIONS.has(extension);

  let mode: "full" | "minimal" | "aggressive" = "full";
  let compacted = selectedContent;

  if (!isLineWindow && isSourceFile) {
    if (selectedContent.length > params.maxChars * 1.15 || selectedLines.length > 350) {
      const minimal = applyMinimalSourceCompaction(selectedContent, extension);
      if (minimal.trim().length > 0 && minimal.length < compacted.length) {
        compacted = minimal;
        mode = "minimal";
      }
    }

    if (compacted.length > params.maxChars * 1.2 || compacted.split("\n").length > 500) {
      const aggressive = applyAggressiveSourceCompaction(compacted, extension);
      if (aggressive.trim().length > 0 && aggressive.length < compacted.length) {
        compacted = aggressive;
        mode = "aggressive";
      }
    }
  }

  const truncated = truncateText(
    compacted,
    params.maxChars,
    "\n\n[Output truncated — use start_line/end_line to read specific ranges]",
  );

  return {
    output: truncated.text,
    truncated: truncated.truncated,
    summary: buildFileReadSummary({
      mode,
      isDataFile,
      linesReturned: selectedLines.length,
      totalLines: lines.length,
    }),
    debug: {
      compactionMode: mode,
      isDataFile,
      totalLines: lines.length,
      linesReturned: selectedLines.length,
    },
  };
}

function buildFileReadSummary(params: {
  mode: "full" | "minimal" | "aggressive";
  isDataFile: boolean;
  linesReturned: number;
  totalLines: number;
}): string {
  if (params.isDataFile || params.mode === "full") {
    return `Read ${params.linesReturned} line${params.linesReturned === 1 ? "" : "s"}`;
  }

  return `Read ${params.linesReturned} lines (${params.mode} source compaction)`;
}

function applyMinimalSourceCompaction(content: string, extension: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inBlockComment = false;
  let previousBlank = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const blockMarkers = getBlockCommentMarkers(extension);

    if (blockMarkers && !inBlockComment && trimmed.startsWith(blockMarkers.start)) {
      inBlockComment = !trimmed.includes(blockMarkers.end);
      continue;
    }

    if (inBlockComment) {
      if (blockMarkers && trimmed.includes(blockMarkers.end)) {
        inBlockComment = false;
      }
      continue;
    }

    const lineCommentPrefix = getLineCommentPrefix(extension);
    if (lineCommentPrefix && trimmed.startsWith(lineCommentPrefix)) {
      continue;
    }

    if (trimmed.length === 0) {
      if (!previousBlank) {
        result.push("");
      }
      previousBlank = true;
      continue;
    }

    previousBlank = false;
    result.push(line);
  }

  return result.join("\n").trim();
}

function applyAggressiveSourceCompaction(content: string, extension: string): string {
  const lines = applyMinimalSourceCompaction(content, extension).split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (looksLikeImport(trimmed) || looksLikeSignature(trimmed) || looksLikeDeclaration(trimmed) || trimmed === "}" || trimmed === "{" || trimmed.endsWith("{")) {
      kept.push(line);
    }
  }

  return kept.join("\n").trim();
}

function looksLikeImport(line: string): boolean {
  return /^(import\s|export\s+.+\s+from\s|from\s.+\s+import\s|use\s|#include\s|package\s|namespace\s)/.test(line);
}

function looksLikeSignature(line: string): boolean {
  return /^(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(?:function|fn|def|class|interface|type|enum|struct|trait|impl)\s+/.test(line);
}

function looksLikeDeclaration(line: string): boolean {
  return /^(?:const|let|var|type|interface|enum|class|function|fn|def)\s+/.test(line);
}

function getLineCommentPrefix(extension: string): string | undefined {
  switch (extension) {
    case ".py":
    case ".rb":
    case ".sh":
    case ".bash":
    case ".zsh":
      return "#";
    default:
      return "//";
  }
}

function getBlockCommentMarkers(extension: string): { start: string; end: string } | undefined {
  switch (extension) {
    case ".py":
      return { start: '"""', end: '"""' };
    case ".rb":
      return { start: "=begin", end: "=end" };
    case ".sh":
    case ".bash":
    case ".zsh":
      return undefined;
    default:
      return { start: "/*", end: "*/" };
  }
}