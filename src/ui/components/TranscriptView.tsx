import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";
import { VISIBLE_MESSAGE_COUNT } from "../types.js";
import { PEBBLE_ASCII_LOGO_LINES, truncateMiddle } from "./WelcomeHeader.js";
import { summarizeToolArgs } from "../toolStatus.js";

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

type TableAlignment = "left" | "center" | "right";

interface LinkTokenMatchGroups {
  markdownLabel?: string;
  markdownHref?: string;
  autoHref?: string;
  boldAsterisk?: string;
  boldUnderscore?: string;
  code?: string;
  italicAsterisk?: string;
  italicUnderscore?: string;
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
      rows.push(...messageToRows(group.call, width, `${group.key}:call`, {
        toolResolved: Boolean(group.result),
      }, blinkPhase));
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
  rows.push({ key: "banner:meta", segments: [createSpan(metadataLine, { color: "#aaaaaa" })] });
  rows.push({ key: "banner:cwd", segments: [createSpan(cwdLine, { color: "#aaaaaa" })] });
  rows.push({ key: "banner:gap:1", segments: [createSpan("")] });

  if (isEmptyState) {
    pushWrappedRows(
      rows,
      "banner:hint",
      "",
      "",
      "Use /help if you want commands.",
      width,
      { color: "#aaaaaa" },
    );

    return rows;
  }

  rows.push({
    key: "banner:hint",
    segments: [createSpan("Ask Pebble anything, or use /help", { color: "#aaaaaa" })],
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
      while (index + 1 < messages.length && messages[index + 1]?.role === "progress") {
        index += 1;
      }
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
  options: { collapseDetails?: boolean; toolResolved?: boolean } = {},
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
      pushWrappedRows(rows, keyBase, "› ", "  ", message.content || "(empty)", width, { color: "#aaaaaa" });
      return rows;

    case "output":
      pushWrappedRows(rows, keyBase, "└ ", "  ", message.content || "(empty)", width, { color: "white", dimColor: true });
      return rows;

    case "tool": {
      const toolName = meta?.toolName ?? message.content;
      const header = compactParts([toolName, summarizeToolArgs(meta?.toolArgs, 60)]);
      const toolResolved = options.toolResolved === true;
      const marker = `${getStatusDot(toolResolved ? "complete" : "tool-running", blinkPhase)} `;
      const toolColor = toolResolved ? "#888888" : "yellow";
      pushWrappedRows(
        rows,
        keyBase,
        marker,
        "  ",
        header || toolName,
        width,
        { color: toolColor, bold: true },
        {
          prefixStyle: {
            color: toolResolved ? "#888888" : (blinkPhase ? "yellow" : "gray"),
            bold: true,
          },
        },
      );

      const aliasLine = meta?.requestedToolName && meta.requestedToolName !== toolName
        ? `requested as ${meta.requestedToolName}`
        : meta?.qualifiedToolName;
      if (aliasLine) {
        pushWrappedRows(rows, `${keyBase}:alias`, "  ", "  ", aliasLine, width, { color: "#888888" });
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
        pushWrappedRows(rows, `${keyBase}:summary`, "  ", "  ", meta.summary, width, { color: "#888888" });
      }

      if (meta?.errorMessage && meta.errorMessage !== meta.toolOutput) {
        pushWrappedRows(rows, `${keyBase}:error`, "  ", "  ", meta.errorMessage, width, { color: "red" });
      }

      const extraMeta = compactParts([meta?.toolCallId, meta?.requestedToolName, meta?.qualifiedToolName]);
      if (!collapseDetails && extraMeta) {
        pushWrappedRows(rows, `${keyBase}:meta`, "  ", "  ", extraMeta, width, { color: "#888888" });
      }

      return rows;
    }

    case "progress":
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
  const sourceLines = options.markdown
    ? renderMarkdownLines(text, style, Math.min(firstLineWidth, nextLineWidth))
    : renderPlainLines(text, style);

  sourceLines.forEach((sourceLine, lineIndex) => {
    const targetWidth = lineIndex === 0 ? firstLineWidth : nextLineWidth;
    const wrapped = spansWidth(sourceLine.spans) <= targetWidth
      ? [sourceLine.spans]
      : wrapStyledLine(sourceLine.spans, targetWidth);
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

function renderMarkdownLines(text: string, style: RowStyle, maxWidth = Number.POSITIVE_INFINITY): StyledLine[] {
  const sourceLines = text.length === 0 ? [""] : text.split("\n");
  const rendered: StyledLine[] = [];
  let inCodeBlock = false;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const sourceLine = sourceLines[index] ?? "";

    if (/^\s*```/.test(sourceLine)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      rendered.push({ spans: [createSpan(sourceLine, { ...style, color: style.color ?? "cyan" })] });
      continue;
    }

    const tableBlock = consumeMarkdownTable(sourceLines, index, style, maxWidth);
    if (tableBlock) {
      rendered.push(...tableBlock.lines);
      index = tableBlock.nextIndex;
      continue;
    }

    const ruleLine = renderMarkdownRule(sourceLine, style, maxWidth);
    if (ruleLine) {
      rendered.push(ruleLine);
      continue;
    }

    const quoteLines = renderMarkdownQuote(sourceLine, style, maxWidth);
    if (quoteLines) {
      rendered.push(...quoteLines);
      continue;
    }

    const headingMatch = sourceLine.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      rendered.push({ spans: parseInlineMarkdown(headingMatch[2] ?? "", { ...style, bold: true }) });
      continue;
    }

    const taskListMatch = sourceLine.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (taskListMatch) {
      const checked = (taskListMatch[2] ?? " ").toLowerCase() === "x";
      rendered.push(...renderPrefixedMarkdownLines(
        [createSpan(`${taskListMatch[1] ?? ""}${checked ? "☑" : "☐"} `, checked ? { ...style, color: style.color ?? "green", bold: true } : { ...style, color: style.color ?? "gray" })],
        parseInlineMarkdown(taskListMatch[3] ?? "", style),
        maxWidth,
        [createSpan(`${taskListMatch[1] ?? ""}  `, style)],
      ));
      continue;
    }

    const bulletMatch = sourceLine.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bulletMatch) {
      rendered.push(...renderPrefixedMarkdownLines(
        [createSpan(`${bulletMatch[1] ?? ""}• `, style)],
        parseInlineMarkdown(bulletMatch[2] ?? "", style),
        maxWidth,
        [createSpan(`${bulletMatch[1] ?? ""}  `, style)],
      ));
      continue;
    }

    const orderedMatch = sourceLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const orderedPrefix = `${orderedMatch[1] ?? ""}${orderedMatch[2] ?? "1"}. `;
      rendered.push(...renderPrefixedMarkdownLines(
        [createSpan(orderedPrefix, style)],
        parseInlineMarkdown(orderedMatch[3] ?? "", style),
        maxWidth,
        [createSpan(" ".repeat(stringWidth(orderedPrefix)), style)],
      ));
      continue;
    }

    rendered.push({ spans: parseInlineMarkdown(sourceLine, style) });
  }

  return rendered.length > 0 ? rendered : [{ spans: [createSpan("", style)] }];
}

function renderMarkdownRule(sourceLine: string, style: RowStyle, maxWidth: number): StyledLine | null {
  if (!/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(sourceLine)) {
    return null;
  }

  const ruleWidth = Math.max(8, Number.isFinite(maxWidth) ? maxWidth : 24);
  return {
    spans: [createSpan("─".repeat(ruleWidth), { color: style.color ?? "gray", dimColor: true })],
  };
}

function renderMarkdownQuote(sourceLine: string, style: RowStyle, maxWidth: number): StyledLine[] | null {
  const quoteMatch = sourceLine.match(/^(\s*)(>\s?)+(.*)$/);
  if (!quoteMatch) {
    return null;
  }

  const level = (quoteMatch[2]?.match(/>/g) ?? []).length;
  const indent = quoteMatch[1] ?? "";
  const content = quoteMatch[3] ?? "";
  const railStyle: RowStyle = { color: style.color ?? "gray", dimColor: true };
  const prefixText = `${indent}${"│ ".repeat(Math.max(1, level))}`;

  return renderPrefixedMarkdownLines(
    [createSpan(prefixText, railStyle)],
    parseInlineMarkdown(content, { ...style, dimColor: true }),
    maxWidth,
    [createSpan(prefixText, railStyle)],
  );
}

function renderPrefixedMarkdownLines(
  prefixSpans: TranscriptSpan[],
  contentSpans: TranscriptSpan[],
  maxWidth: number,
  continuationPrefixSpans = prefixSpans,
): StyledLine[] {
  const firstWidth = Math.max(4, maxWidth - spansWidth(prefixSpans));
  const continuationWidth = Math.max(4, maxWidth - spansWidth(continuationPrefixSpans));
  const wrapped = wrapStyledLine(contentSpans, firstWidth, continuationWidth);

  return wrapped.map((line, index) => ({
    spans: [
      ...(index === 0 ? prefixSpans : continuationPrefixSpans),
      ...line,
    ],
  }));
}

function consumeMarkdownTable(
  sourceLines: string[],
  startIndex: number,
  style: RowStyle,
  maxWidth: number,
): { lines: StyledLine[]; nextIndex: number } | null {
  const headerLine = sourceLines[startIndex];
  const separatorLine = sourceLines[startIndex + 1];
  if (!headerLine || !separatorLine) {
    return null;
  }

  const headerCells = splitMarkdownTableRow(headerLine);
  const separatorCells = splitMarkdownTableRow(separatorLine);
  if (
    headerCells.length === 0
    || headerCells.length !== separatorCells.length
    || !separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  ) {
    return null;
  }

  const rows: string[][] = [headerCells];
  let endIndex = startIndex + 2;
  while (endIndex < sourceLines.length) {
    const candidate = splitMarkdownTableRow(sourceLines[endIndex] ?? "");
    if (candidate.length !== headerCells.length) {
      break;
    }

    rows.push(candidate);
    endIndex += 1;
  }

  if (rows.length === 1) {
    return null;
  }

  return {
    lines: renderTableBlock(rows, separatorCells.map(parseTableAlignment), style, maxWidth),
    nextIndex: endIndex - 1,
  };
}

function splitMarkdownTableRow(line: string): string[] {
  if (!line.includes("|")) {
    return [];
  }

  let value = line.trim();
  if (value.startsWith("|")) {
    value = value.slice(1);
  }
  if (value.endsWith("|")) {
    value = value.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && value[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }

    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseTableAlignment(value: string): TableAlignment {
  const trimmed = value.trim();
  const startsWithColon = trimmed.startsWith(":");
  const endsWithColon = trimmed.endsWith(":");

  if (startsWithColon && endsWithColon) {
    return "center";
  }

  if (endsWithColon) {
    return "right";
  }

  return "left";
}

function renderTableBlock(
  rows: string[][],
  alignments: TableAlignment[],
  style: RowStyle,
  maxWidth: number,
): StyledLine[] {
  const columnCount = rows[0]?.length ?? 0;
  if (columnCount === 0) {
    return [{ spans: [createSpan("", style)] }];
  }

  const parsedRows = rows.map((cells, rowIndex) =>
    cells.map((cell) => parseInlineMarkdown(cell, rowIndex === 0 ? { ...style, bold: true } : style))
  );
  const naturalWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(1, ...parsedRows.map((row) => spansWidth(row[columnIndex] ?? [createSpan("")])))
  );
  const fittedWidths = fitTableColumnWidths(naturalWidths, maxWidth);
  if (!fittedWidths) {
    return rows.map((cells, rowIndex) => ({
      spans: parseInlineMarkdown(cells.join(" | "), rowIndex === 0 ? { ...style, bold: true } : style),
    }));
  }

  const borderStyle: RowStyle = { color: style.color, dimColor: style.dimColor };
  const rendered: StyledLine[] = [
    { spans: buildTableBorder("top", fittedWidths, borderStyle) },
    { spans: buildTableContentRow(parsedRows[0] ?? [], fittedWidths, alignments, borderStyle) },
    { spans: buildTableBorder("header", fittedWidths, borderStyle) },
  ];

  parsedRows.slice(1).forEach((row, rowIndex, array) => {
    rendered.push({ spans: buildTableContentRow(row, fittedWidths, alignments, borderStyle) });
    if (rowIndex < array.length - 1) {
      rendered.push({ spans: buildTableBorder("middle", fittedWidths, borderStyle) });
    }
  });

  rendered.push({ spans: buildTableBorder("bottom", fittedWidths, borderStyle) });
  return rendered;
}

function fitTableColumnWidths(widths: number[], maxWidth: number): number[] | null {
  const borderWidth = widths.length * 3 + 1;
  const available = Math.max(0, maxWidth - borderWidth);
  if (available < widths.length) {
    return null;
  }

  const fitted = [...widths];
  const minimumWidth = available >= widths.length * 3 ? 3 : 1;
  let total = fitted.reduce((sum, width) => sum + width, 0);

  while (total > available) {
    const maxWidthValue = Math.max(...fitted);
    const columnIndex = fitted.findIndex((width) => width === maxWidthValue);
    const currentWidth = columnIndex >= 0 ? fitted[columnIndex] : undefined;
    if (columnIndex < 0 || typeof currentWidth !== "number" || currentWidth <= minimumWidth) {
      break;
    }

    fitted[columnIndex] = currentWidth - 1;
    total -= 1;
  }

  if (total > available) {
    return null;
  }

  return fitted;
}

function buildTableBorder(
  kind: "top" | "header" | "middle" | "bottom",
  widths: number[],
  style: RowStyle,
): TranscriptSpan[] {
  const glyphs = {
    top: { left: "┌", middle: "┬", right: "┐" },
    header: { left: "├", middle: "┼", right: "┤" },
    middle: { left: "├", middle: "┼", right: "┤" },
    bottom: { left: "└", middle: "┴", right: "┘" },
  }[kind];

  const spans: TranscriptSpan[] = [createSpan(glyphs.left, style)];
  widths.forEach((width, index) => {
    spans.push(createSpan("─".repeat(width + 2), style));
    spans.push(createSpan(index === widths.length - 1 ? glyphs.right : glyphs.middle, style));
  });
  return spans;
}

function buildTableContentRow(
  row: TranscriptSpan[][],
  widths: number[],
  alignments: TableAlignment[],
  borderStyle: RowStyle,
): TranscriptSpan[] {
  const spans: TranscriptSpan[] = [createSpan("│", borderStyle)];

  widths.forEach((width, index) => {
    spans.push(...padTableCell(row[index] ?? [createSpan("")], width, alignments[index] ?? "left", borderStyle));
    spans.push(createSpan("│", borderStyle));
  });

  return mergeAdjacentSpans(spans);
}

function padTableCell(
  cellSpans: TranscriptSpan[],
  width: number,
  alignment: TableAlignment,
  borderStyle: RowStyle,
): TranscriptSpan[] {
  const content = truncateStyledSpans(cellSpans, width);
  const contentWidth = spansWidth(content);
  const remaining = Math.max(0, width - contentWidth);
  const leftPadding = alignment === "right"
    ? remaining
    : alignment === "center"
      ? Math.floor(remaining / 2)
      : 0;
  const rightPadding = remaining - leftPadding;

  return mergeAdjacentSpans([
    createSpan(" ", borderStyle),
    createSpan(" ".repeat(leftPadding), borderStyle),
    ...content,
    createSpan(" ".repeat(rightPadding), borderStyle),
    createSpan(" ", borderStyle),
  ]);
}

function truncateStyledSpans(spans: TranscriptSpan[], width: number): TranscriptSpan[] {
  if (width <= 0) {
    return [createSpan("")];
  }

  if (spansWidth(spans) <= width) {
    return spans;
  }

  const ellipsis = width > 1 ? "…" : "";
  const targetWidth = Math.max(0, width - stringWidth(ellipsis));
  const result: TranscriptSpan[] = [];
  let consumed = 0;

  for (const span of spans) {
    if (consumed >= targetWidth) {
      break;
    }

    const remaining = targetWidth - consumed;
    const [head] = splitTextByWidth(span.text, remaining);
    if (head.length === 0) {
      continue;
    }

    result.push(createSpan(head, span));
    consumed += stringWidth(head);
  }

  if (ellipsis) {
    const ellipsisSource = result[result.length - 1] ?? spans[0] ?? createSpan("");
    result.push(createSpan(ellipsis, ellipsisSource));
  }

  return mergeAdjacentSpans(result);
}

function spansWidth(spans: TranscriptSpan[]): number {
  return spans.reduce((total, span) => total + stringWidth(span.text), 0);
}

function parseInlineMarkdown(text: string, style: RowStyle): TranscriptSpan[] {
  if (text.length === 0) {
    return [createSpan("", style)];
  }

  const result: TranscriptSpan[] = [];
  const pattern = /\[(?<markdownLabel>[^\]\n]+)\]\((?<markdownHref>https?:\/\/[^\s)]+)\)|<(?<autoHref>https?:\/\/[^>\s]+)>|(?<autoHref>https?:\/\/[^\s<]+)|(?<boldAsterisk>\*\*[^*]+\*\*)|(?<boldUnderscore>__[^_]+__)|(?<code>`[^`]+`)|(?<italicAsterisk>\*[^*\n]+\*)|(?<italicUnderscore>_[^_\n]+_)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      result.push(createSpan(text.slice(lastIndex, index), style));
    }

    const token = match[0] ?? "";
    const groups = (match.groups ?? {}) as LinkTokenMatchGroups;
    if (groups.markdownLabel && groups.markdownHref) {
      result.push(...renderLinkSpans(groups.markdownLabel, groups.markdownHref, style));
    } else if (groups.autoHref) {
      result.push(createSpan(trimTrailingUrlPunctuation(groups.autoHref), { ...style, color: "cyan" }));
    } else if (token.startsWith("**") || token.startsWith("__")) {
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

function renderLinkSpans(label: string, href: string, style: RowStyle): TranscriptSpan[] {
  const trimmedHref = trimTrailingUrlPunctuation(href);
  const labelSpans = parseInlineMarkdown(label, { ...style, color: "cyan" });
  const labelText = label.trim();

  if (labelText === trimmedHref) {
    return [createSpan(trimmedHref, { ...style, color: "cyan" })];
  }

  return mergeAdjacentSpans([
    ...labelSpans,
    createSpan(" → ", { color: style.color ?? "gray", dimColor: true }),
    createSpan(trimmedHref, { ...style, color: "cyan" }),
  ]);
}

function trimTrailingUrlPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/u, "");
}

function wrapStyledLine(spans: TranscriptSpan[], width: number, continuationWidth = width): TranscriptSpan[][] {
  if (spans.length === 0 || spans.every((span) => span.text.length === 0)) {
    return [[createSpan("")]];
  }

  const lines: TranscriptSpan[][] = [];
  let currentLine: TranscriptSpan[] = [];
  let currentWidth = 0;
  let currentLimit = Math.max(1, width);

  const pushLine = () => {
    lines.push(trimTrailingWhitespace(currentLine));
    currentLine = [];
    currentWidth = 0;
    currentLimit = Math.max(1, continuationWidth);
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
        if (currentWidth + tokenWidth > currentLimit) {
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
        const remainingWidth = currentLimit - currentWidth;

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

        const [head, tail] = splitTextByWidth(remaining, currentLimit);
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
