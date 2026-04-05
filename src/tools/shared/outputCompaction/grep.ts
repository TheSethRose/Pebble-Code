import {
  DEFAULT_GREP_LINE_LENGTH,
  DEFAULT_GREP_PER_FILE_LIMIT,
  DEFAULT_GREP_TOTAL_LIMIT,
  type GrepMatchGroup,
} from "./shared.js";

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