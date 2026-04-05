import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { truncateText } from "./common.js";

export type ShellCommandFamily =
  | "git-status"
  | "git-diff-stat"
  | "git-log-oneline"
  | "test"
  | "diagnostics"
  | "generic";

export interface ShellExecutionSummary {
  output: string;
  summary: string;
  truncated: boolean;
  debug: Record<string, unknown>;
}

export interface GrepMatchGroup {
  file: string;
  matches: Array<{ line: number; content: string }>;
}

const DEFAULT_RAW_OUTPUT_LIMIT = 20_000;
const DEFAULT_GREP_LINE_LENGTH = 120;
const DEFAULT_GREP_PER_FILE_LIMIT = 5;
const DEFAULT_GREP_TOTAL_LIMIT = 200;
const DATA_FILE_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  ".tsv",
  ".md",
  ".markdown",
  ".txt",
  ".env",
  ".lock",
]);
const SOURCE_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".hh",
  ".sh",
  ".bash",
  ".zsh",
]);

export function summarizeShellExecution(params: {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  maxChars?: number;
}): ShellExecutionSummary {
  const rawOutput = [params.stdout, params.stderr].filter(Boolean).join("\n\n").trim() || "(no output)";
  const family = detectShellCommandFamily(params.command);
  const baseDebug = {
    command: params.command,
    commandFamily: family,
    exitCode: params.exitCode,
  } satisfies Record<string, unknown>;

  switch (family) {
    case "git-status":
      return finalizeShellSummary({
        ...params,
        family,
        rawOutput,
        baseDebug,
        compacted: compactGitStatus(rawOutput),
      });
    case "git-diff-stat":
      return finalizeShellSummary({
        ...params,
        family,
        rawOutput,
        baseDebug,
        compacted: compactGitDiffStat(rawOutput),
      });
    case "git-log-oneline":
      return finalizeShellSummary({
        ...params,
        family,
        rawOutput,
        baseDebug,
        compacted: compactGitLogOneline(rawOutput),
      });
    case "test":
      return finalizeShellSummary({
        ...params,
        family,
        rawOutput,
        baseDebug,
        compacted: compactTestOutput(rawOutput, params.exitCode),
      });
    case "diagnostics":
      return finalizeShellSummary({
        ...params,
        family,
        rawOutput,
        baseDebug,
        compacted: compactDiagnosticsOutput(rawOutput, params.exitCode),
      });
    case "generic": {
      const truncated = truncateText(rawOutput, params.maxChars ?? DEFAULT_RAW_OUTPUT_LIMIT);
      return {
        output: truncated.text,
        summary: params.exitCode === 0 ? "Executed shell command" : `Command failed with exit code ${params.exitCode}`,
        truncated: truncated.truncated,
        debug: {
          ...baseDebug,
          compactionApplied: false,
          rawOutputBytes: rawOutput.length,
        },
      };
    }
  }
}

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

export function compactGrepOutput(params: {
  rawOutput: string;
  maxResults?: number;
  maxLineLength?: number;
  maxPerFile?: number;
}): {
  output: string;
  summary: string;
  truncated: boolean;
  groups: GrepMatchGroup[];
  totalMatches: number;
} {
  const groups = parseGrepMatchGroups(params.rawOutput);
  const totalMatches = groups.reduce((count, group) => count + group.matches.length, 0);
  const maxResults = Math.min(params.maxResults ?? DEFAULT_GREP_TOTAL_LIMIT, DEFAULT_GREP_TOTAL_LIMIT);
  const maxPerFile = params.maxPerFile ?? DEFAULT_GREP_PER_FILE_LIMIT;
  const maxLineLength = params.maxLineLength ?? DEFAULT_GREP_LINE_LENGTH;

  const lines: string[] = [];
  let shown = 0;

  for (const group of groups) {
    if (shown >= maxResults) {
      break;
    }

    lines.push(`[file] ${group.file} (${group.matches.length})`);
    const visibleMatches = group.matches.slice(0, maxPerFile);
    for (const match of visibleMatches) {
      if (shown >= maxResults) {
        break;
      }

      lines.push(`  ${match.line}: ${compactMatchedLine(match.content, maxLineLength)}`);
      shown += 1;
    }

    if (group.matches.length > visibleMatches.length) {
      lines.push(`  +${group.matches.length - visibleMatches.length} more`);
    }

    lines.push("");
  }

  if (shown < totalMatches) {
    lines.push(`... +${totalMatches - shown} more matches`);
  }

  const truncated = shown < totalMatches;
  const summary = totalMatches === 0
    ? "Found 0 matches"
    : `Found ${totalMatches} matches across ${groups.length} file${groups.length === 1 ? "" : "s"}`;

  return {
    output: lines.join("\n").trim() || "No matches found.",
    summary,
    truncated,
    groups,
    totalMatches,
  };
}

export function persistRawToolOutput(params: {
  cwd: string;
  category: "shell" | "grep" | "read";
  identifier: string;
  rawOutput: string;
}): string | undefined {
  if (!params.rawOutput.trim()) {
    return undefined;
  }

  const dir = join(params.cwd, ".pebble", "tool-outputs");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const safeIdentifier = params.identifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "output";
  const filePath = join(dir, `${params.category}-${Date.now()}-${safeIdentifier}.log`);
  writeFileSync(filePath, params.rawOutput, "utf-8");
  return filePath;
}

function finalizeShellSummary(params: {
  command: string;
  cwd: string;
  exitCode: number;
  maxChars?: number;
  rawOutput: string;
  family: ShellCommandFamily;
  baseDebug: Record<string, unknown>;
  compacted: { output: string; summary: string; debug?: Record<string, unknown> };
}): ShellExecutionSummary {
  const shouldPersistRaw = params.exitCode !== 0 || params.rawOutput.length > (params.maxChars ?? DEFAULT_RAW_OUTPUT_LIMIT);
  const rawOutputPath = shouldPersistRaw
    ? persistRawToolOutput({
        cwd: params.cwd,
        category: "shell",
        identifier: params.family,
        rawOutput: params.rawOutput,
      })
    : undefined;

  const persistedHint = rawOutputPath ? `\n\n[Full output saved to ${rawOutputPath}]` : "";
  const output = `${params.compacted.output}${persistedHint}`;
  const wasCompacted = output.trim() !== params.rawOutput.trim() || Boolean(rawOutputPath);

  return {
    output,
    summary: params.compacted.summary,
    truncated: wasCompacted,
    debug: {
      ...params.baseDebug,
      ...(params.compacted.debug ?? {}),
      compactionApplied: true,
      rawOutputBytes: params.rawOutput.length,
      ...(rawOutputPath ? { rawOutputPath } : {}),
    },
  };
}

function detectShellCommandFamily(command: string): ShellCommandFamily {
  const normalized = command.trim().replace(/\s+/g, " ").toLowerCase();

  if (/^git status(?:\s|$)/.test(normalized)) {
    return "git-status";
  }

  if (/^git diff(?:\s|$)/.test(normalized)) {
    return "git-diff-stat";
  }

  if (/^git log(?:\s|$)/.test(normalized) && normalized.includes("--oneline")) {
    return "git-log-oneline";
  }

  if (/^(bun test|bun run test|cargo test|pytest(?:\s|$)|go test(?:\s|$)|vitest(?:\s|$)|jest(?:\s|$)|npm test(?:\s|$)|pnpm test(?:\s|$)|yarn test(?:\s|$))/.test(normalized)) {
    return "test";
  }

  if (/^(bun run build|bun run typecheck|tsc(?:\s|$)|eslint(?:\s|$)|biome(?:\s|$)|ruff(?:\s|$)|cargo build(?:\s|$)|cargo clippy(?:\s|$))/.test(normalized)) {
    return "diagnostics";
  }

  return "generic";
}

function compactGitStatus(rawOutput: string): { output: string; summary: string; debug: Record<string, unknown> } {
  const lines = rawOutput.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  if (lines.length === 0) {
    return {
      output: "Working tree clean.",
      summary: "Git status · clean",
      debug: { fileCount: 0, stagedCount: 0, unstagedCount: 0, untrackedCount: 0 },
    };
  }

  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  let modifiedCount = 0;
  let addedCount = 0;
  let deletedCount = 0;
  let renamedCount = 0;

  const visibleFiles = lines.slice(0, 12);
  for (const line of lines) {
    const status = line.slice(0, 2);
    if (status === "??") {
      untrackedCount += 1;
      continue;
    }

    if (status[0] && status[0] !== " ") {
      stagedCount += 1;
    }
    if (status[1] && status[1] !== " ") {
      unstagedCount += 1;
    }

    if (status.includes("M")) modifiedCount += 1;
    if (status.includes("A")) addedCount += 1;
    if (status.includes("D")) deletedCount += 1;
    if (status.includes("R")) renamedCount += 1;
  }

  const summaryBits = [
    stagedCount > 0 ? `${stagedCount} staged` : undefined,
    unstagedCount > 0 ? `${unstagedCount} unstaged` : undefined,
    untrackedCount > 0 ? `${untrackedCount} untracked` : undefined,
  ].filter((value): value is string => Boolean(value));
  const detailBits = [
    modifiedCount > 0 ? `${modifiedCount} modified` : undefined,
    addedCount > 0 ? `${addedCount} added` : undefined,
    deletedCount > 0 ? `${deletedCount} deleted` : undefined,
    renamedCount > 0 ? `${renamedCount} renamed` : undefined,
  ].filter((value): value is string => Boolean(value));

  const outputLines = [
    `Files changed: ${lines.length}`,
    summaryBits.length > 0 ? `State: ${summaryBits.join(", ")}` : undefined,
    detailBits.length > 0 ? `Kinds: ${detailBits.join(", ")}` : undefined,
    "",
    ...visibleFiles,
    lines.length > visibleFiles.length ? `... +${lines.length - visibleFiles.length} more` : undefined,
  ].filter((line): line is string => Boolean(line));

  return {
    output: outputLines.join("\n"),
    summary: `Git status · ${lines.length} file${lines.length === 1 ? "" : "s"}`,
    debug: {
      fileCount: lines.length,
      stagedCount,
      unstagedCount,
      untrackedCount,
    },
  };
}

function compactGitDiffStat(rawOutput: string): { output: string; summary: string } {
  const lines = rawOutput.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  const statLines = lines.filter((line) => line.includes("|") || /files? changed|insertions?\(\+\)|deletions?\(-\)/.test(line));
  const visible = statLines.slice(0, 12);
  const summaryLine = statLines.findLast((line) => /files? changed|insertions?\(\+\)|deletions?\(-\)/.test(line));

  return {
    output: [
      ...visible,
      summaryLine && !visible.includes(summaryLine) ? summaryLine : undefined,
      statLines.length > visible.length ? `... +${statLines.length - visible.length} more` : undefined,
    ].filter((line): line is string => Boolean(line)).join("\n") || rawOutput,
    summary: summaryLine ? `Git diff · ${summaryLine}` : "Git diff summary",
  };
}

function compactGitLogOneline(rawOutput: string): { output: string; summary: string } {
  const lines = rawOutput.split("\n").map((line) => line.trim()).filter(Boolean);
  const visible = lines.slice(0, 10);
  return {
    output: [
      ...visible,
      lines.length > visible.length ? `... +${lines.length - visible.length} more commits` : undefined,
    ].filter((line): line is string => Boolean(line)).join("\n"),
    summary: `Git log · ${lines.length} commit${lines.length === 1 ? "" : "s"}`,
  };
}

function compactTestOutput(rawOutput: string, exitCode: number): { output: string; summary: string; debug: Record<string, unknown> } {
  const lines = rawOutput.split("\n").map((line) => line.trimEnd());
  const summaryLines = uniqueStrings(lines.filter((line) => /(?:\bpass(?:ed)?\b|\bfail(?:ed)?\b|\bskip(?:ped)?\b|\berror(?:s)?\b|test result:|Ran \d+ tests?|\d+ passing|\d+ failing|\d+ failed)/i.test(line))).slice(0, 6);
  const failureLines = uniqueStrings(lines.filter((line) => /(?:^FAIL\b|^FAILED\b|\berror\b|panic|assert(?:ion)?|Exception|✗|^not ok\b)/i.test(line))).slice(0, 14);
  const outputLines = [
    exitCode === 0 ? "Tests passed." : `Tests failed (exit ${exitCode}).`,
    summaryLines.length > 0 ? "" : undefined,
    ...summaryLines,
    failureLines.length > 0 ? "" : undefined,
    ...failureLines,
  ].filter((line): line is string => Boolean(line));

  return {
    output: outputLines.join("\n") || rawOutput,
    summary: exitCode === 0
      ? summaryLines[0] ?? "Tests passed"
      : `Tests failed${summaryLines[0] ? ` · ${summaryLines[0]}` : ` with exit code ${exitCode}`}`,
    debug: {
      summaryLineCount: summaryLines.length,
      surfacedFailureLines: failureLines.length,
    },
  };
}

function compactDiagnosticsOutput(rawOutput: string, exitCode: number): { output: string; summary: string; debug: Record<string, unknown> } {
  const lines = rawOutput.split("\n").map((line) => line.trimEnd());
  const diagnostics = uniqueStrings(lines.filter((line) => /(?:\berror\b|\bwarning\b|✖|×|^\s*at\s|^\s*-->\s|\.ts\(\d+,\d+\)|:[0-9]+:[0-9]+)/i.test(line))).slice(0, 18);
  const errorCount = lines.filter((line) => /\berror\b/i.test(line)).length;
  const warningCount = lines.filter((line) => /\bwarning\b/i.test(line)).length;

  const summaryBits = [
    errorCount > 0 ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : undefined,
    warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    output: [
      exitCode === 0 ? "Diagnostics completed." : `Diagnostics failed (exit ${exitCode}).`,
      summaryBits.length > 0 ? summaryBits.join(", ") : undefined,
      diagnostics.length > 0 ? "" : undefined,
      ...diagnostics,
    ].filter((line): line is string => Boolean(line)).join("\n") || rawOutput,
    summary: summaryBits.length > 0 ? `Diagnostics · ${summaryBits.join(", ")}` : (exitCode === 0 ? "Diagnostics completed" : `Diagnostics failed with exit code ${exitCode}`),
    debug: {
      errorCount,
      warningCount,
      surfacedDiagnosticLines: diagnostics.length,
    },
  };
}

function parseGrepMatchGroups(rawOutput: string): GrepMatchGroup[] {
  const groups = new Map<string, Array<{ line: number; content: string }>>();

  for (const line of rawOutput.split("\n")) {
    const match = line.match(/^(.*):(\d+):(.*)$/);
    if (!match) {
      continue;
    }

    const file = match[1]?.trim();
    const lineNumber = Number(match[2]);
    const content = match[3]?.trim();
    if (!file || !Number.isFinite(lineNumber) || !content) {
      continue;
    }

    const next = groups.get(file) ?? [];
    next.push({ line: lineNumber, content });
    groups.set(file, next);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, matches]) => ({
      file,
      matches,
    }));
}

function compactMatchedLine(line: string, maxLength: number): string {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const start = Math.max(0, Math.floor((normalized.length - maxLength) / 2));
  const slice = normalized.slice(start, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxLength < normalized.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function buildCompactOutputIdentifier(input: string): string {
  const trimmed = input.trim();
  return basename(trimmed).replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 48) || "output";
}