import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { findProjectRoot } from "../runtime/trust.js";

export type ContextAttachmentSource = "opencode" | "repomix";

export interface ContextAttachmentIndexEntry {
  key: string;
  source: ContextAttachmentSource;
  path: string;
  displayPath: string;
  description: string;
  absolutePath?: string;
}

export interface ResolvedContextAttachment extends ContextAttachmentIndexEntry {
  content: string;
}

export interface ContextAttachmentIndex {
  entries: ContextAttachmentIndexEntry[];
  search: (query: string, limit?: number) => ContextAttachmentIndexEntry[];
  resolve: (entry: ContextAttachmentIndexEntry) => ResolvedContextAttachment | null;
}

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".lock",
  ".icns",
  ".ico",
]);
const ignoredDirectories = new Set([".git", "node_modules"]);

export function createContextAttachmentIndex(cwd: string): ContextAttachmentIndex {
  const projectRoot = findProjectRoot(cwd) ?? cwd;
  const contextRoot = join(projectRoot, "private", "context");
  const opencodeRoot = join(contextRoot, "opencode");
  const repomixPath = join(contextRoot, "repomix-claude.xml");

  const repomixContents = new Map<string, string>();
  const repomixEntries = parseRepomixEntries(repomixPath, repomixContents);
  const opencodeEntries = walkDirectory(opencodeRoot).map((absolutePath) => {
    const path = normalizeRelativePath(relative(opencodeRoot, absolutePath));
    return {
      key: `opencode:${path}`,
      source: "opencode" as const,
      path,
      displayPath: `opencode/${path}`,
      description: "opencode workspace snapshot",
      absolutePath,
    };
  });

  const entries = [...opencodeEntries, ...repomixEntries].sort((left, right) => {
    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }

    return left.path.localeCompare(right.path);
  });

  return {
    entries,
    search(query, limit = 8) {
      return searchEntries(entries, query, limit);
    },
    resolve(entry) {
      if (entry.source === "opencode") {
        if (!entry.absolutePath) {
          return null;
        }

        return {
          ...entry,
          content: readFileSync(entry.absolutePath, "utf8"),
        };
      }

      const content = repomixContents.get(entry.key);
      if (!content) {
        return null;
      }

      return {
        ...entry,
        content,
      };
    },
  };
}

function parseRepomixEntries(
  filePath: string,
  contents: Map<string, string>,
): ContextAttachmentIndexEntry[] {
  let xml = "";
  try {
    xml = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const entries: ContextAttachmentIndexEntry[] = [];
  const pattern = /<file path="([^"]+)">\n?([\s\S]*?)<\/file>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const path = normalizeRelativePath(match[1] ?? "");
    if (!path) {
      continue;
    }

    const content = (match[2] ?? "").replace(/^\n/u, "").replace(/\n$/u, "");
    const key = `repomix:${path}`;
    contents.set(key, content);
    entries.push({
      key,
      source: "repomix",
      path,
      displayPath: `repomix/${path}`,
      description: "repomix packed reference",
    });
  }

  return entries;
}

function walkDirectory(root: string): string[] {
  try {
    const stat = statSync(root);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const results: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const name of readdirSync(current)) {
      if (ignoredDirectories.has(name)) {
        continue;
      }

      const absolutePath = join(current, name);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      if (isBinaryPath(name)) {
        continue;
      }

      results.push(absolutePath);
    }
  }

  return results;
}

function searchEntries(
  entries: ContextAttachmentIndexEntry[],
  query: string,
  limit: number,
): ContextAttachmentIndexEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries.slice(0, limit);
  }

  return entries
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, normalized),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.entry.displayPath.length - right.entry.displayPath.length;
    })
    .slice(0, limit)
    .map((item) => item.entry);
}

function scoreEntry(entry: ContextAttachmentIndexEntry, query: string): number {
  const path = entry.displayPath.toLowerCase();
  const name = basename(entry.path).toLowerCase();
  if (name === query) return 120;
  if (path === query) return 115;
  if (name.startsWith(query)) return 100;
  if (path.startsWith(query)) return 85;
  if (name.includes(query)) return 70;
  if (path.includes(query)) return 55;
  return 0;
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isBinaryPath(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return [...binaryExtensions].some((extension) => lower.endsWith(extension));
}
