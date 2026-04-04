import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";
import { VISIBLE_MESSAGE_COUNT } from "../types.js";
import { PEBBLE_ASCII_LOGO_LINES, truncateMiddle } from "./WelcomeHeader.js";

interface TranscriptViewProps {
  messages: DisplayMessage[];
  /** Optional Pebble banner shown at the top of the scrollable transcript. */
  banner?: {
    cwd: string;
    model: string;
    providerLabel?: string;
    sessionId: string | null;
  };
  /** Number of transcript rows shifted upward from the live tail. */
  scrollOffset?: number;
  /** Whether the current assistant turn is still actively streaming/running tools. */
  isProcessing?: boolean;
  /** Blink state for in-progress message indicators. */
  blinkPhase?: boolean;
  /** Fallback row budget when maxRows is not provided. */
  maxMessages?: number;
  /** Exact transcript row budget available in the layout. */
  maxRows?: number;
  /** Approximate terminal width used for deterministic wrapping. */
  width?: number;
}

interface TranscriptSpan {
  text: string;
  color?: string;
  backgroundColor?: string;
  dimColor?: boolean;
  bold?: boolean;
  italic?: boolean;
}

interface TranscriptRow {
  key: string;
  segments: TranscriptSpan[];
}

type GroupedItem =
  | { type: "single"; key: string; message: DisplayMessage }
  | { type: "tool-group"; key: string; call: DisplayMessage; result?: DisplayMessage };

interface TranscriptMetrics {
  totalRows: number;
  contentBudget: number;
  maxScrollOffset: number;
}

type RowStyle = Omit<TranscriptSpan, "text">;

interface StyledLine {
  spans: TranscriptSpan[];
}

/**
 * Deterministic line-virtualized transcript viewport.
 *
 * Standard Ink does not expose the custom ScrollBox internals used by the
 * reference app, so this component renders an explicit row model instead of
 * trusting Box/Text wrapping to fit inside the remaining terminal height.
 */
export function TranscriptView({
  messages,
  banner,
  scrollOffset = 0,
  isProcessing = false,
  blinkPhase = true,
  maxMessages = VISIBLE_MESSAGE_COUNT,
  maxRows,
  width = 80,
}: TranscriptViewProps) {
  const rows = buildTranscriptRows(messages, width, isProcessing, blinkPhase, banner);
  const { totalRows, contentBudget, maxScrollOffset } = buildTranscriptMetrics(rows.length, maxRows, maxMessages);
  const clampedOffset = Math.min(scrollOffset, maxScrollOffset);
  const end = Math.max(0, totalRows - clampedOffset);
  const start = Math.max(0, end - contentBudget);
  const visibleRows = rows.slice(start, end);

  return (
    <Box flexDirection="column">
      {visibleRows.map((row) => (
        <Text key={row.key}>
          {getRenderableSegments(row.segments).map((segment, segmentIndex) => (
            <Text
              key={`${row.key}:${segmentIndex}`}
              color={segment.color}
              backgroundColor={segment.backgroundColor}
              dimColor={segment.dimColor}
              bold={segment.bold}
              italic={segment.italic}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

export function getTranscriptLineCount(messages: DisplayMessage[], width = 80): number {
  return buildTranscriptRows(messages, width, false, true).length;
}

export function getTranscriptMetrics(
  messages: DisplayMessage[],
  {
    width = 80,
    maxRows,
    maxMessages = VISIBLE_MESSAGE_COUNT,
    isProcessing = false,
    banner,
  }: {
    width?: number;
    maxRows?: number;
    maxMessages?: number;
    isProcessing?: boolean;
    banner?: TranscriptViewProps["banner"];
  } = {},
): TranscriptMetrics {
  const rows = buildTranscriptRows(messages, width, isProcessing, true, banner);
  return buildTranscriptMetrics(rows.length, maxRows, maxMessages);
}

function buildTranscriptMetrics(totalRows: number, maxRows?: number, maxMessages = VISIBLE_MESSAGE_COUNT): TranscriptMetrics {
  const contentBudget = Math.max(1, maxRows ?? maxMessages);
  return {
    totalRows,
    contentBudget,
    maxScrollOffset: Math.max(0, totalRows - contentBudget),
  };
}

function buildTranscriptRows(
  messages: DisplayMessage[],
  width: number,
  isProcessing: boolean,
  blinkPhase: boolean,
  banner?: TranscriptViewProps["banner"],
): TranscriptRow[] {
  const grouped = groupMessages(messages);
  const rows: TranscriptRow[] = [];

  if (banner) {
    rows.push(...buildBannerRows(banner, width, messages.length === 0));
  }

  grouped.forEach((group, index) => {
    if (rows.length > 0) {
      rows.push({ key: `gap:${group.key}`, segments: [createSpan("")] });
    }

    if (group.type === "tool-group") {
      rows.push(...messageToRows(group.call, width, `${group.key}:call`, {}, blinkPhase));
      if (group.result) {
        rows.push(...messageToRows(group.result, width, `${group.key}:result`, {
          collapseDetails: !isProcessing && !group.result.meta?.isError,
        }, blinkPhase));
      }
      return;
    }

    rows.push(...messageToRows(group.message, width, group.key, {
      collapseDetails: group.message.role === "tool_result" && !isProcessing && !group.message.meta?.isError,
    }, blinkPhase));
  });

  return rows;
}

function buildBannerRows(
  banner: NonNullable<TranscriptViewProps["banner"]>,
  width: number,
  isEmptyState: boolean,
): TranscriptRow[] {
  const sessionLabel = banner.sessionId ? `session ${banner.sessionId.slice(0, 8)}` : "new session";
  const modelLine = banner.providerLabel ? `${banner.model} · ${banner.providerLabel}` : banner.model;
  const metadataLine = `${modelLine} • ${sessionLabel}`;
  const cwdLine = truncateMiddle(banner.cwd, Math.max(28, width - 4));
  const rows: TranscriptRow[] = PEBBLE_ASCII_LOGO_LINES.map((line, index) => ({
    key: `banner:logo:${index}`,
    segments: [createSpan(line, { color: "green", bold: true })],
  }));

  rows.push({ key: "banner:gap:0", segments: [createSpan("")] });
  rows.push({ key: "banner:meta", segments: [createSpan(metadataLine, { color: "gray" })] });
  rows.push({ key: "banner:cwd", segments: [createSpan(cwdLine, { color: "gray" })] });
  rows.push({ key: "banner:gap:1", segments: [createSpan("")] });

  if (isEmptyState) {
    pushWrappedRows(
      rows,
      "banner:hint",
      "",
      "",
      "Use /help if you want commands.",
      width,
      { color: "gray" },
    );

    return rows;
  }

  rows.push({
    key: "banner:hint",
    segments: [createSpan("Ask Pebble anything, or use /help for commands", { color: "gray" })],
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

function messageToRows(
  message: DisplayMessage,
  width: number,
  keyBase: string,
  options: { collapseDetails?: boolean } = {},
  blinkPhase = true,
): TranscriptRow[] {
  const meta = message.meta;
  const rows: TranscriptRow[] = [];
  const collapseDetails = options.collapseDetails === true;

  switch (message.role) {
    case "user":
      pushWrappedRows(
        rows,
        keyBase,
        "› ",
        "  ",
        message.content || "(empty)",
        width,
        { color: "white", backgroundColor: "gray", bold: true },
        { markdown: true },
      );
      return rows;

    case "assistant":
      pushWrappedRows(rows, keyBase, `${getStatusDot("complete", blinkPhase)} `, "  ", message.content || "(empty)", width, { color: "white" }, { markdown: true });
      return rows;

    case "streaming":
      pushWrappedRows(
        rows,
        `${keyBase}:body`,
        `${getStatusDot("in-progress", blinkPhase)} `,
        "  ",
        appendCursor(message.content || "Thinking…"),
        width,
        { color: "yellow" },
        {
          markdown: true,
          prefixStyle: { color: blinkPhase ? "yellow" : "gray" },
        },
      );
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
      pushWrappedRows(
        rows,
        keyBase,
        `${getStatusDot("tool-running", blinkPhase)} `,
        "  ",
        header || toolName,
        width,
        { color: "yellow", bold: true },
        { prefixStyle: { color: blinkPhase ? "yellow" : "gray", bold: true } },
      );

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
      const marker = `${getStatusDot(isError ? "failed" : "complete", blinkPhase)} `;
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

      if (!collapseDetails && meta?.toolOutput) {
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

      if (!collapseDetails && meta?.summary && meta.summary !== meta.toolOutput) {
        pushWrappedRows(rows, `${keyBase}:summary`, "  ", "  ", meta.summary, width, { color: "gray", dimColor: true });
      }

      if (meta?.errorMessage && meta.errorMessage !== meta.toolOutput) {
        pushWrappedRows(rows, `${keyBase}:error`, "  ", "  ", meta.errorMessage, width, { color: "red" });
      }

      const extraMeta = compactParts([meta?.toolCallId, meta?.requestedToolName, meta?.qualifiedToolName]);
      if (!collapseDetails && extraMeta) {
        pushWrappedRows(rows, `${keyBase}:meta`, "  ", "  ", extraMeta, width, { color: "gray", dimColor: true });
      }

      return rows;
    }

    case "progress":
      rows.push({
        key: keyBase,
        segments: [createSpan(`${getStatusDot("in-progress", blinkPhase)} ${meta?.turnNumber != null ? `[turn ${meta.turnNumber}] ` : ""}${message.content}`, { color: "cyan", dimColor: true })],
      });
      return rows;

    case "error":
      pushWrappedRows(rows, keyBase, `${getStatusDot("failed", blinkPhase)} `, "  ", message.content || "Error", width, { color: "red", bold: true }, { markdown: true });
      return rows;

    default:
      pushWrappedRows(rows, keyBase, `${getStatusDot("complete", blinkPhase)} `, "  ", message.content || "(empty)", width, { color: "white" });
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
  style: RowStyle,
  options: { markdown?: boolean; prefixStyle?: RowStyle } = {},
): void {
  const prefixWidth = stringWidth(prefix);
  const continuationWidth = stringWidth(continuationPrefix);
  const firstLineWidth = Math.max(8, width - prefixWidth - 2);
  const nextLineWidth = Math.max(8, width - continuationWidth - 2);
  const sourceLines = options.markdown ? renderMarkdownLines(text, style) : renderPlainLines(text, style);

  sourceLines.forEach((sourceLine, lineIndex) => {
    const wrapped = wrapStyledLine(sourceLine.spans, lineIndex === 0 ? firstLineWidth : nextLineWidth);
    wrapped.forEach((segment, segmentIndex) => {
      const isFirstRenderedLine = lineIndex === 0 && segmentIndex === 0;
      rows.push({
        key: `${keyBase}:${lineIndex}:${segmentIndex}`,
        segments: [createSpan(isFirstRenderedLine ? prefix : continuationPrefix, options.prefixStyle ?? style), ...segment],
      });
    });
  });
}

function renderPlainLines(text: string, style: RowStyle): StyledLine[] {
  const sourceLines = text.length === 0 ? [""] : text.split("\n");
  return sourceLines.map((line) => ({ spans: [createSpan(line, style)] }));
}

function renderMarkdownLines(text: string, style: RowStyle): StyledLine[] {
  const sourceLines = text.length === 0 ? [""] : text.split("\n");
  const rendered: StyledLine[] = [];
  let inCodeBlock = false;

  for (const sourceLine of sourceLines) {
    if (/^\s*```/.test(sourceLine)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      rendered.push({ spans: [createSpan(sourceLine, { ...style, color: style.color ?? "cyan" })] });
      continue;
    }

    const headingMatch = sourceLine.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      rendered.push({ spans: parseInlineMarkdown(headingMatch[2] ?? "", { ...style, bold: true }) });
      continue;
    }

    const bulletMatch = sourceLine.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bulletMatch) {
      rendered.push({
        spans: [
          createSpan(`${bulletMatch[1] ?? ""}• `, style),
          ...parseInlineMarkdown(bulletMatch[2] ?? "", style),
        ],
      });
      continue;
    }

    const orderedMatch = sourceLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      rendered.push({
        spans: [
          createSpan(`${orderedMatch[1] ?? ""}${orderedMatch[2] ?? "1"}. `, style),
          ...parseInlineMarkdown(orderedMatch[3] ?? "", style),
        ],
      });
      continue;
    }

    rendered.push({ spans: parseInlineMarkdown(sourceLine, style) });
  }

  return rendered.length > 0 ? rendered : [{ spans: [createSpan("", style)] }];
}

function parseInlineMarkdown(text: string, style: RowStyle): TranscriptSpan[] {
  if (text.length === 0) {
    return [createSpan("", style)];
  }

  const result: TranscriptSpan[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      result.push(createSpan(text.slice(lastIndex, index), style));
    }

    const token = match[0] ?? "";
    if (token.startsWith("**") || token.startsWith("__")) {
      result.push(createSpan(token.slice(2, -2), { ...style, bold: true }));
    } else if (token.startsWith("`")) {
      result.push(createSpan(token.slice(1, -1), { ...style, color: style.color ?? "cyan", bold: true }));
    } else {
      result.push(createSpan(token.slice(1, -1), { ...style, italic: true }));
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    result.push(createSpan(text.slice(lastIndex), style));
  }

  return result.length > 0 ? mergeAdjacentSpans(result) : [createSpan("", style)];
}

function wrapStyledLine(spans: TranscriptSpan[], width: number): TranscriptSpan[][] {
  if (spans.length === 0 || spans.every((span) => span.text.length === 0)) {
    return [[createSpan("")]];
  }

  const lines: TranscriptSpan[][] = [];
  let currentLine: TranscriptSpan[] = [];
  let currentWidth = 0;

  const pushLine = () => {
    lines.push(trimTrailingWhitespace(currentLine));
    currentLine = [];
    currentWidth = 0;
  };

  for (const span of spans) {
    for (const token of tokenizeSpan(span)) {
      if (token.text.length === 0) {
        continue;
      }

      if (/^\s+$/.test(token.text)) {
        if (currentWidth === 0) {
          continue;
        }

        const tokenWidth = stringWidth(token.text);
        if (currentWidth + tokenWidth > width) {
          pushLine();
          continue;
        }

        currentLine = appendSpan(currentLine, token);
        currentWidth += tokenWidth;
        continue;
      }

      let remaining = token.text;
      while (remaining.length > 0) {
        const tokenWidth = stringWidth(remaining);
        const remainingWidth = width - currentWidth;

        if (tokenWidth <= remainingWidth) {
          currentLine = appendSpan(currentLine, createSpan(remaining, token));
          currentWidth += tokenWidth;
          remaining = "";
          continue;
        }

        if (currentWidth > 0) {
          pushLine();
          continue;
        }

        const [head, tail] = splitTextByWidth(remaining, width);
        currentLine = appendSpan(currentLine, createSpan(head, token));
        currentWidth += stringWidth(head);
        pushLine();
        remaining = tail;
      }
    }
  }

  if (currentLine.length > 0 || lines.length === 0) {
    pushLine();
  }

  return lines;
}

function tokenizeSpan(span: TranscriptSpan): TranscriptSpan[] {
  const parts = span.text.match(/\s+|\S+/g) ?? [""];
  return parts.map((part) => createSpan(part, span));
}

function splitTextByWidth(text: string, width: number): [string, string] {
  const chars = [...text];
  return [chars.slice(0, width).join(""), chars.slice(width).join("")];
}

function trimTrailingWhitespace(spans: TranscriptSpan[]): TranscriptSpan[] {
  const trimmed = [...spans];

  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (!last) {
      break;
    }

    const nextText = last.text.replace(/\s+$/u, "");
    if (nextText.length === last.text.length) {
      break;
    }

    if (nextText.length === 0) {
      trimmed.pop();
      continue;
    }

    trimmed[trimmed.length - 1] = createSpan(nextText, last);
    break;
  }

  return trimmed.length > 0 ? mergeAdjacentSpans(trimmed) : [createSpan("")];
}

function appendSpan(spans: TranscriptSpan[], span: TranscriptSpan): TranscriptSpan[] {
  if (span.text.length === 0) {
    return spans;
  }

  const last = spans[spans.length - 1];
  if (
    last
    && last.color === span.color
    && last.backgroundColor === span.backgroundColor
    && last.dimColor === span.dimColor
    && last.bold === span.bold
    && last.italic === span.italic
  ) {
    return [...spans.slice(0, -1), createSpan(last.text + span.text, span)];
  }

  return [...spans, span];
}

function mergeAdjacentSpans(spans: TranscriptSpan[]): TranscriptSpan[] {
  return spans.reduce<TranscriptSpan[]>((acc, span) => appendSpan(acc, span), []);
}

function createSpan(text: string, style: RowStyle = {}): TranscriptSpan {
  return {
    text,
    color: style.color,
    backgroundColor: style.backgroundColor,
    dimColor: style.dimColor,
    bold: style.bold,
    italic: style.italic,
  };
}

function getRenderableSegments(segments: TranscriptSpan[]): TranscriptSpan[] {
  if (segments.some((segment) => segment.text.length > 0)) {
    return segments;
  }

  const firstSegment = segments[0];
  return [createSpan(" ", firstSegment)];
}

function getStatusDot(state: "in-progress" | "tool-running" | "complete" | "failed", blinkPhase: boolean): string {
  switch (state) {
    case "in-progress":
    case "tool-running":
      return blinkPhase ? "●" : "○";
    case "failed":
      return "●";
    case "complete":
    default:
      return "●";
  }
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
