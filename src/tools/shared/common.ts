import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export const DEFAULT_TEXT_PREVIEW_LIMIT = 12_000;

export function resolveWorkspacePath(filePath: string, cwd: string): string {
  return filePath.startsWith("/") ? filePath : resolve(cwd, filePath);
}

export function truncateText(
  value: string,
  maxChars: number,
  suffix = "\n\n[Output truncated]",
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  return {
    text: `${value.slice(0, maxChars)}${suffix}`,
    truncated: true,
  };
}

export function safePreviewText(filePath: string, maxChars = DEFAULT_TEXT_PREVIEW_LIMIT): {
  kind: "text" | "directory" | "missing" | "binary";
  preview: string;
  truncated: boolean;
} {
  if (!existsSync(filePath)) {
    return { kind: "missing", preview: "Path does not exist", truncated: false };
  }

  const stats = lstatSync(filePath);
  if (stats.isDirectory()) {
    return { kind: "directory", preview: listDirectory(filePath).join("\n"), truncated: false };
  }

  const content = readFileSync(filePath);
  if (looksBinary(content)) {
    return {
      kind: "binary",
      preview: `${basename(filePath)} appears to be a binary file (${content.byteLength} bytes).`,
      truncated: false,
    };
  }

  const text = content.toString("utf-8");
  const truncated = truncateText(text, maxChars, "\n\n[Preview truncated]");
  return {
    kind: "text",
    preview: truncated.text,
    truncated: truncated.truncated,
  };
}

export function listDirectory(
  dirPath: string,
  options: {
    includeHidden?: boolean;
    maxEntries?: number;
  } = {},
): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => options.includeHidden || !entry.name.startsWith("."))
    .sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) return -1;
      if (!left.isDirectory() && right.isDirectory()) return 1;
      return left.name.localeCompare(right.name);
    })
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);

  return typeof options.maxEntries === "number"
    ? entries.slice(0, options.maxEntries)
    : entries;
}

export function renderProjectTree(
  rootPath: string,
  options: {
    maxDepth?: number;
    includeHidden?: boolean;
    maxEntriesPerDirectory?: number;
  } = {},
): string[] {
  if (!existsSync(rootPath)) {
    return [`Missing path: ${rootPath}`];
  }

  const maxDepth = options.maxDepth ?? 3;
  const maxEntriesPerDirectory = options.maxEntriesPerDirectory ?? 50;
  const lines: string[] = [basename(rootPath) || rootPath];

  function walk(currentPath: string, depth: number, prefix: string) {
    if (depth >= maxDepth) {
      return;
    }

    const entries = readdirSync(currentPath, { withFileTypes: true })
      .filter((entry) => options.includeHidden || !entry.name.startsWith("."))
      .sort((left, right) => {
        if (left.isDirectory() && !right.isDirectory()) return -1;
        if (!left.isDirectory() && right.isDirectory()) return 1;
        return left.name.localeCompare(right.name);
      })
      .slice(0, maxEntriesPerDirectory);

    entries.forEach((entry, index) => {
      const connector = index === entries.length - 1 ? "└─ " : "├─ ";
      const nextPrefix = `${prefix}${index === entries.length - 1 ? "   " : "│  "}`;
      lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory()) {
        walk(resolve(currentPath, entry.name), depth + 1, nextPrefix);
      }
    });
  }

  if (lstatSync(rootPath).isDirectory()) {
    walk(rootPath, 0, "");
  }

  return lines;
}

export function normalizeJsonText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}
