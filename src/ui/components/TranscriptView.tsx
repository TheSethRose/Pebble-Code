import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";
import { VISIBLE_MESSAGE_COUNT } from "../types.js";

interface TranscriptViewProps {
  messages: DisplayMessage[];
  /** Number of transcript rows shifted upward from the live tail. */
  scrollOffset?: number;
  /** Fallback row budget when maxRows is not provided. */
  maxMessages?: number;
  /** Exact transcript row budget available in the layout. */
  maxRows?: number;
  /** Approximate terminal width used for deterministic wrapping. */
  width?: number;
}

interface TranscriptRow {
  key: string;
  text: string;
  color?: string;
  dimColor?: boolean;
  bold?: boolean;
}

type GroupedItem =
  | { type: "single"; key: string; message: DisplayMessage }
  | { type: "tool-group"; key: string; call: DisplayMessage; result?: DisplayMessage };

const INDICATOR_ROW_BUDGET = 2;

/**
 * Deterministic line-virtualized transcript viewport.
 *
 * Standard Ink does not expose the custom ScrollBox internals used by the
 * reference app, so this component renders an explicit row model instead of
 * trusting Box/Text wrapping to fit inside the remaining terminal height.
 */
export function TranscriptView({
  messages,
  scrollOffset = 0,
  maxMessages = VISIBLE_MESSAGE_COUNT,
  maxRows,
  width = 80,
}: TranscriptViewProps) {
  const rows = buildTranscriptRows(messages, width);
  const totalRows = rows.length;
  const contentBudget = Math.max(1, (maxRows ?? maxMessages) - INDICATOR_ROW_BUDGET);
  const clampedOffset = Math.min(scrollOffset, Math.max(0, totalRows - 1));
  const end = Math.max(0, totalRows - clampedOffset);
  const start = Math.max(0, end - contentBudget);
  const visibleRows = rows.slice(start, end);
  const hiddenAbove = start;
  const hiddenBelow = totalRows - end;

  return (
    <Box flexDirection="column">
      {hiddenAbove > 0 && (
        <Text color="gray">· earlier history above · scroll to browse · End to jump live</Text>
      )}

      {visibleRows.map((row) => (
        <Text key={row.key} color={row.color} dimColor={row.dimColor} bold={row.bold}>
          {row.text}
        </Text>
      ))}

      {hiddenBelow > 0 && (
        <Text color="gray">· newer history below · scroll down to continue</Text>
      )}
    </Box>
  );
}

export function getTranscriptLineCount(messages: DisplayMessage[], width = 80): number {
  return buildTranscriptRows(messages, width).length;
}

function buildTranscriptRows(messages: DisplayMessage[], width: number): TranscriptRow[] {
  const grouped = groupMessages(messages);
  const rows: TranscriptRow[] = [];

  grouped.forEach((group, index) => {
    if (index > 0) {
      rows.push({ key: `gap:${group.key}`, text: "" });
    }

    if (group.type === "tool-group") {
      rows.push(...messageToRows(group.call, width, `${group.key}:call`));
      if (group.result) {
        rows.push(...messageToRows(group.result, width, `${group.key}:result`));
      }
      return;
    }

    rows.push(...messageToRows(group.message, width, group.key));
  });

  return rows;
}

function groupMessages(messages: DisplayMessage[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index]!;

    if (message.role === "tool" && messages[index + 1]?.role === "tool_result") {
      items.push({
        type: "tool-group",
        key: buildGroupKey(message, index, messages[index + 1], index + 1),
        call: message,
        result: messages[index + 1],
      });
      index += 2;
      continue;
    }

    if (message.role === "progress") {
      let latest = message;
      while (index + 1 < messages.length && messages[index + 1]?.role === "progress") {
        index += 1;
        latest = messages[index]!;
      }

      items.push({
        type: "single",
        key: buildMessageKey(latest, index),
        message: latest,
      });
      index += 1;
      continue;
    }

    items.push({
      type: "single",
      key: buildMessageKey(message, index),
      message,
    });
    index += 1;
  }

  return items;
}

function messageToRows(message: DisplayMessage, width: number, keyBase: string): TranscriptRow[] {
  const meta = message.meta;
  const rows: TranscriptRow[] = [];

  switch (message.role) {
    case "user":
      pushWrappedRows(rows, keyBase, "> ", "  ", message.content || "(empty)", width, { color: "white" });
      return rows;

    case "assistant":
      pushWrappedRows(rows, keyBase, "● ", "  ", message.content || "(empty)", width, { color: "white" });
      return rows;

    case "streaming":
      rows.push({ key: `${keyBase}:thinking`, text: "∴ Thinking…", color: "gray", dimColor: true });
      pushWrappedRows(rows, `${keyBase}:body`, "  ", "  ", appendCursor(message.content), width, { color: "white" });
      return rows;

    case "command":
      pushWrappedRows(rows, keyBase, "› ", "  ", message.content || "(empty)", width, { color: "gray" });
      return rows;

    case "output":
      pushWrappedRows(rows, keyBase, "└ ", "  ", message.content || "(empty)", width, { color: "white", dimColor: true });
      return rows;

    case "tool": {
      const toolName = meta?.toolName ?? message.content;
      const header = compactParts([toolName, meta?.toolArgs ? compactArgs(meta.toolArgs) : ""]);
      pushWrappedRows(rows, keyBase, "⧈ ", "  ", header || toolName, width, { color: "yellow", bold: true });

      const aliasLine = meta?.requestedToolName && meta.requestedToolName !== toolName
        ? `requested as ${meta.requestedToolName}`
        : meta?.qualifiedToolName;
      if (aliasLine) {
        pushWrappedRows(rows, `${keyBase}:alias`, "  ", "  ", aliasLine, width, { color: "gray", dimColor: true });
      }
      return rows;
    }

    case "tool_result": {
      const isError = meta?.isError ?? false;
      const marker = isError ? "✗ " : "✓ ";
      const toolName = meta?.toolName ?? "tool";
      const durationSuffix = typeof meta?.durationMs === "number" ? ` (${meta.durationMs} ms)` : "";
      const truncatedSuffix = meta?.truncated ? " [truncated]" : "";
      pushWrappedRows(
        rows,
        keyBase,
        marker,
        "  ",
        `${toolName} ${isError ? "failed" : "done"}${durationSuffix}${truncatedSuffix}`,
        width,
        { color: isError ? "red" : "green" },
      );

      if (meta?.toolOutput) {
        pushWrappedRows(
          rows,
          `${keyBase}:output`,
          "  ",
          "  ",
          formatBodyPreview(meta.toolOutput),
          width,
          { color: isError ? "red" : "white", dimColor: !isError },
        );
      }

      if (meta?.summary && meta.summary !== meta.toolOutput) {
        pushWrappedRows(rows, `${keyBase}:summary`, "  ", "  ", meta.summary, width, { color: "gray", dimColor: true });
      }

      if (meta?.errorMessage && meta.errorMessage !== meta.toolOutput) {
        pushWrappedRows(rows, `${keyBase}:error`, "  ", "  ", meta.errorMessage, width, { color: "red" });
      }

      const extraMeta = compactParts([meta?.toolCallId, meta?.requestedToolName, meta?.qualifiedToolName]);
      if (extraMeta) {
        pushWrappedRows(rows, `${keyBase}:meta`, "  ", "  ", extraMeta, width, { color: "gray", dimColor: true });
      }

      return rows;
    }

    case "progress":
      rows.push({
        key: keyBase,
        text: `↻ ${meta?.turnNumber != null ? `[turn ${meta.turnNumber}] ` : ""}${message.content}`,
        color: "cyan",
        dimColor: true,
      });
      return rows;

    case "error":
      pushWrappedRows(rows, keyBase, "✗ ", "  ", message.content || "Error", width, { color: "red", bold: true });
      return rows;

    default:
      pushWrappedRows(rows, keyBase, "• ", "  ", message.content || "(empty)", width, { color: "white" });
      return rows;
  }
}

function pushWrappedRows(
  rows: TranscriptRow[],
  keyBase: string,
  prefix: string,
  continuationPrefix: string,
  text: string,
  width: number,
  style: Pick<TranscriptRow, "color" | "dimColor" | "bold">,
): void {
  const prefixWidth = stringWidth(prefix);
  const continuationWidth = stringWidth(continuationPrefix);
  const firstLineWidth = Math.max(8, width - prefixWidth - 2);
  const nextLineWidth = Math.max(8, width - continuationWidth - 2);
  const sourceLines = text.length === 0 ? [""] : text.split("\n");

  sourceLines.forEach((sourceLine, lineIndex) => {
    const wrapped = wrapLine(sourceLine, lineIndex === 0 ? firstLineWidth : nextLineWidth);
    wrapped.forEach((segment, segmentIndex) => {
      const isFirstRenderedLine = lineIndex === 0 && segmentIndex === 0;
      rows.push({
        key: `${keyBase}:${lineIndex}:${segmentIndex}`,
        text: `${isFirstRenderedLine ? prefix : continuationPrefix}${segment}`,
        ...style,
      });
    });
  });
}

function wrapLine(text: string, width: number): string[] {
  if (text.length === 0) {
    return [""];
  }

  const result: string[] = [];
  let remaining = text;

  while (remaining.length > width) {
    let breakIndex = remaining.lastIndexOf(" ", width);
    if (breakIndex <= 0 || breakIndex < Math.floor(width * 0.5)) {
      breakIndex = width;
    }
    result.push(remaining.slice(0, breakIndex));
    remaining = remaining.slice(breakIndex).trimStart();
  }

  result.push(remaining);
  return result;
}

function stringWidth(value: string): number {
  return [...value].length;
}

function appendCursor(value: string): string {
  return value.length > 0 ? `${value}▍` : "▍";
}

function compactArgs(args: Record<string, unknown>, maxLen = 60): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    parts.push(`${key}: ${rendered}`);
  }
  const joined = parts.join(", ");
  return joined.length > maxLen ? `${joined.slice(0, maxLen - 1)}…` : joined;
}

function compactParts(values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value && value.trim())).join(" · ");
}

function formatBodyPreview(value: string, maxLines = 10, maxChars = 1_200): string {
  const limitedChars = value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
  const lines = limitedChars.split("\n");
  return lines.length > maxLines ? `${lines.slice(0, maxLines).join("\n")}\n…` : limitedChars;
}

function buildMessageKey(message: DisplayMessage, index: number): string {
  return [
    "msg",
    index,
    message.role,
    message.meta?.toolCallId ?? "",
    message.meta?.toolName ?? "",
    message.content.slice(0, 24),
  ].join(":");
}

function buildGroupKey(call: DisplayMessage, callIndex: number, result: DisplayMessage | undefined, resultIndex: number): string {
  return [
    "tool-group",
    call.meta?.toolCallId ?? result?.meta?.toolCallId ?? `${callIndex}-${resultIndex}`,
    call.meta?.toolName ?? call.content,
  ].join(":");
}
