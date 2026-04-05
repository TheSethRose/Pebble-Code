export type ShellCommandFamily =
  | "git-status"
  | "git-diff-name-only"
  | "git-diff-stat"
  | "git-show-stat"
  | "git-branch-vv"
  | "git-stash-list"
  | "git-ls-files"
  | "git-log-oneline"
  | "test"
  | "diagnostics"
  | "generic";

export interface ShellExecutionSummary {
  output: string;
  summary: string;
  truncated: boolean;
  debug: Record<string, unknown>;
  commandFamily: ShellCommandFamily;
  rawOutputPath?: string;
}

export type CompactionMode = "off" | "auto" | "aggressive";

export interface GrepMatchGroup {
  file: string;
  matches: Array<{ line: number; content: string }>;
}

export const DEFAULT_RAW_OUTPUT_LIMIT = 20_000;
export const DEFAULT_GREP_LINE_LENGTH = 120;
export const DEFAULT_GREP_PER_FILE_LIMIT = 5;
export const DEFAULT_GREP_TOTAL_LIMIT = 200;

export const DATA_FILE_EXTENSIONS = new Set([
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

export const SOURCE_FILE_EXTENSIONS = new Set([
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

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function getVisibleItemLimit(mode: CompactionMode, limits: { auto: number; aggressive: number }): number {
  return mode === "aggressive" ? limits.aggressive : limits.auto;
}