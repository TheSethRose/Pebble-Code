import type { ContextAttachmentIndexEntry } from "./contextAttachmentIndex.js";

export function buildContextAttachmentToken(
  entry: ContextAttachmentIndexEntry | string,
): string {
  const displayPath = typeof entry === "string" ? entry : entry.displayPath;
  return `@${displayPath}`;
}

export function hasContextAttachmentToken(
  text: string,
  entry: ContextAttachmentIndexEntry | string,
): boolean {
  const token = escapeRegExp(buildContextAttachmentToken(entry));
  return new RegExp(`(^|\\s)${token}(?=\\s|$)`, "u").test(text);
}

export function mergeContextAttachmentEntries(
  current: ContextAttachmentIndexEntry[],
  additions: ContextAttachmentIndexEntry[],
): ContextAttachmentIndexEntry[] {
  const byKey = new Map<string, ContextAttachmentIndexEntry>();

  for (const entry of [...current, ...additions]) {
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
  }

  return [...byKey.values()];
}

export function collectReferencedContextAttachments(
  text: string,
  knownEntries: ContextAttachmentIndexEntry[],
): ContextAttachmentIndexEntry[] {
  return mergeContextAttachmentEntries([], knownEntries)
    .filter((entry) => hasContextAttachmentToken(text, entry));
}

export function serializeContextAttachmentMetadata(
  entries: ContextAttachmentIndexEntry[],
): Array<Pick<ContextAttachmentIndexEntry, "key" | "source" | "path" | "displayPath">> {
  return entries.map((entry) => ({
    key: entry.key,
    source: entry.source,
    path: entry.path,
    displayPath: entry.displayPath,
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}