import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";
import { VISIBLE_MESSAGE_COUNT } from "../types.js";
import { MessageItem } from "./MessageItem.js";

interface TranscriptViewProps {
  messages: DisplayMessage[];
}

/**
 * Streaming-aware transcript renderer.
 *
 * Groups tool_call → tool_result pairs, collapses consecutive progress
 * messages, and renders a blinking cursor on the active streaming token.
 * The VISIBLE_MESSAGE_COUNT window keeps memory bounded.
 */
export function TranscriptView({ messages }: TranscriptViewProps) {
  const grouped = groupMessages(messages);
  const overflow = grouped.length > VISIBLE_MESSAGE_COUNT;
  const visible = overflow ? grouped.slice(-VISIBLE_MESSAGE_COUNT) : grouped;

  return (
    <Box flexDirection="column">
      {overflow && (
        <Box marginBottom={1}>
          <Text color="gray">
            · {messages.length - VISIBLE_MESSAGE_COUNT} earlier messages hidden · /resume to revisit
          </Text>
        </Box>
      )}

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
            key={`${group.message.role}-${i + (messages.length - visible.length)}`}
            message={group.message}
          />
        );
      })}
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
