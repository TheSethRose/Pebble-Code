import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";
import { VISIBLE_MESSAGE_COUNT } from "../types.js";
import { MessageItem } from "./MessageItem.js";

interface TranscriptViewProps {
  messages: DisplayMessage[];
  /**
   * Number of grouped message items to shift the visible window upward from
   * the bottom.  0 (default) = follow the tail (latest messages shown).
   */
  scrollOffset?: number;
  /**
   * Maximum number of grouped items to show at once.  Defaults to
   * VISIBLE_MESSAGE_COUNT.  Derived from available terminal rows in App.
   */
  maxMessages?: number;
}

/**
 * Streaming-aware transcript renderer.
 *
 * Groups tool_call → tool_result pairs, collapses consecutive progress
 * messages, and renders a blinking cursor on the active streaming token.
 * The window is bounded by maxMessages and can be shifted by scrollOffset
 * so the user can page through history without leaving the TUI.
 */
export function TranscriptView({
  messages,
  scrollOffset = 0,
  maxMessages = VISIBLE_MESSAGE_COUNT,
}: TranscriptViewProps) {
  const grouped = groupMessages(messages);
  const total = grouped.length;

  // Clamp scroll so we never go past the first message.
  const clamped = Math.min(scrollOffset, Math.max(0, total - maxMessages));

  const end = Math.max(0, total - clamped);
  const start = Math.max(0, end - maxMessages);
  const visible = grouped.slice(start, end);

  const hiddenAbove = start;              // items before the window
  const hiddenBelow = total - end;        // items after the window (> 0 when scrolled up)
  const isScrolledUp = hiddenBelow > 0;

  return (
    <Box flexDirection="column">
      {/* ── Scroll / overflow indicators ────────────────────────────── */}
      {hiddenAbove > 0 && (
        <Box marginBottom={1}>
          <Text color="gray">
            · {hiddenAbove} earlier message{hiddenAbove !== 1 ? "s" : ""} above
            {isScrolledUp ? " · PgUp to scroll · PgDn to return" : " · /resume to revisit"}
          </Text>
        </Box>
      )}

      {/* ── Visible message window ──────────────────────────────────── */}
      {visible.map((group, i) => {
        if (group.type === "tool-group") {
          return (
            <ToolGroup
              key={`tg-${i}`}
              call={group.call}
              result={group.result}
            />
          );
        }
        return (
          <MessageItem
            key={`${group.message.role}-${start + i}`}
            message={group.message}
          />
        );
      })}

      {/* ── "Newer messages below" indicator when scrolled up ────────── */}
      {isScrolledUp && (
        <Box marginTop={1}>
          <Text color="gray">
            · {hiddenBelow} newer message{hiddenBelow !== 1 ? "s" : ""} below · PgDn to scroll down
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ── Tool call → result grouping ──────────────────────────────────────────────

interface ToolGroupProps {
  call: DisplayMessage;
  result?: DisplayMessage;
}

function ToolGroup({ call, result }: ToolGroupProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageItem message={call} />
      {result && <MessageItem message={result} />}
    </Box>
  );
}

// ── Grouping logic ───────────────────────────────────────────────────────────

type GroupedItem =
  | { type: "single"; message: DisplayMessage }
  | { type: "tool-group"; call: DisplayMessage; result?: DisplayMessage };

function groupMessages(messages: DisplayMessage[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i]!;

    // If this is a tool call and the next message is its result, group them
    if (
      msg.role === "tool" &&
      i + 1 < messages.length &&
      messages[i + 1]?.role === "tool_result"
    ) {
      items.push({ type: "tool-group", call: msg, result: messages[i + 1]! });
      i += 2;
      continue;
    }

    // Collapse consecutive progress messages — only keep the latest
    if (msg.role === "progress") {
      let latest = msg;
      while (i + 1 < messages.length && messages[i + 1]?.role === "progress") {
        i++;
        latest = messages[i]!;
      }
      items.push({ type: "single", message: latest });
      i++;
      continue;
    }

    items.push({ type: "single", message: msg });
    i++;
  }

  return items;
}
