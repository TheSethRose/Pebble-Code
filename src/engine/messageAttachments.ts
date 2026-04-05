import type { Attachment } from "./types.js";

export interface ContextAttachmentMetadata {
  key: string;
  source: string;
  path: string;
  displayPath: string;
}

const textDecoder = new TextDecoder();

export function parseContextAttachmentMetadata(
  value: unknown,
): ContextAttachmentMetadata[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const candidate = item as Record<string, unknown>;
    const key = typeof candidate.key === "string" ? candidate.key : "";
    const source = typeof candidate.source === "string" ? candidate.source : "";
    const path = typeof candidate.path === "string" ? candidate.path : "";
    const displayPath = typeof candidate.displayPath === "string"
      ? candidate.displayPath
      : path || key;

    if (!key || !source || !path || !displayPath) {
      return [];
    }

    return [{ key, source, path, displayPath }];
  });
}

export function getAttachmentTextData(attachment: Attachment): string {
  return typeof attachment.data === "string"
    ? attachment.data
    : textDecoder.decode(attachment.data);
}

export function buildMessageContentWithAttachments(
  content: string,
  attachments?: Attachment[],
  metadata?: Record<string, unknown>,
): string {
  const normalizedContent = content.trim();
  if (!attachments || attachments.length === 0) {
    return normalizedContent;
  }

  const contextAttachments = parseContextAttachmentMetadata(metadata?.contextAttachments);
  const blocks = attachments.map((attachment, index) => {
    const info = contextAttachments[index];
    const label = info?.displayPath || attachment.name || `attachment-${index + 1}`;
    const attributes = [
      `label="${escapeXmlAttribute(label)}"`,
      info?.source ? `source="${escapeXmlAttribute(info.source)}"` : undefined,
      info?.path ? `path="${escapeXmlAttribute(info.path)}"` : undefined,
      attachment.mimeType ? `mime="${escapeXmlAttribute(attachment.mimeType)}"` : undefined,
    ].filter(Boolean).join(" ");

    return [
      `<attached-context-file ${attributes}>`,
      getAttachmentTextData(attachment),
      "</attached-context-file>",
    ].join("\n");
  });

  return [
    normalizedContent,
    "[Attached context files]",
    ...blocks,
  ].filter(Boolean).join("\n\n");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
