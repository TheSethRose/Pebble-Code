import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";
import { VISIBLE_MESSAGE_COUNT } from "../types.js";
import { MessageItem } from "./MessageItem.js";

interface TranscriptViewProps {
  messages: DisplayMessage[];
}

export function TranscriptView({ messages }: TranscriptViewProps) {
  const overflow = messages.length > VISIBLE_MESSAGE_COUNT;
  const visible = overflow ? messages.slice(-VISIBLE_MESSAGE_COUNT) : messages;

  return (
    <Box flexDirection="column">
      {overflow && (
        <Box marginBottom={1}>
          <Text color="gray">
            · {messages.length - VISIBLE_MESSAGE_COUNT} earlier messages hidden · /resume to revisit
          </Text>
        </Box>
      )}

      {visible.map((msg, i) => (
        <MessageItem
          key={`${msg.role}-${i + (messages.length - visible.length)}`}
          message={msg}
        />
      ))}
    </Box>
  );
}
