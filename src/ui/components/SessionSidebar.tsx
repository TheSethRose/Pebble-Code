import React from "react";
import { Box, Text } from "ink";

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  status: string;
  messageCount: number;
}

interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
  selectedIndex: number;
  isFocused: boolean;
  width?: number;
}

const SIDEBAR_WIDTH = 24;

/**
 * Right sidebar listing saved sessions.
 * Index 0 = "New Chat", index 1+ = sessions.
 * When focused, the selected row is highlighted with an inverse cursor.
 */
export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  selectedIndex,
  isFocused,
  width = SIDEBAR_WIDTH,
}: SessionSidebarProps) {
  const maxLabel = width - 4; // padding + icon
  const isNewChatSelected = isFocused && selectedIndex === 0;
  const isNewChatActive = activeSessionId === null;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={isFocused ? "green" : "gray"}
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      paddingX={1}
    >
      {/* Header */}
      <Box marginBottom={sessions.length > 0 ? 1 : 0}>
        <Text dimColor bold>
          Chats {isFocused ? "◀" : " "}
        </Text>
      </Box>

      {/* New Chat entry (index 0) */}
      <Box>
        <Text
          color={isNewChatSelected ? "black" : isNewChatActive ? "green" : "white"}
          backgroundColor={isNewChatSelected ? "green" : undefined}
          bold={isNewChatSelected || isNewChatActive}
        >
          ◈ New Chat
        </Text>
      </Box>

      {/* Session list */}
      {sessions.map((s, i) => {
        const rowIndex = i + 1; // offset by 1 since "New Chat" is 0
        const isActive = s.id === activeSessionId;
        const isCursor = isFocused && selectedIndex === rowIndex;
        const label =
          s.title.length > maxLabel
            ? s.title.slice(0, maxLabel - 1) + "…"
            : s.title;

        return (
          <Box key={s.id}>
            <Text
              color={isCursor ? "black" : isActive ? "green" : "gray"}
              backgroundColor={isCursor ? "green" : undefined}
              bold={isCursor || isActive}
            >
              {isActive && !isCursor ? "▸" : " "} {label}
            </Text>
          </Box>
        );
      })}

      {sessions.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No sessions yet</Text>
        </Box>
      )}

      {/* Hint */}
      {isFocused && (
        <Box marginTop={1}>
          <Text dimColor>↑↓ move · Enter select · Del remove</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Derive a display title from the first user message in the transcript,
 * falling back to "New chat".
 */
export function deriveSessionTitle(
  messages: Array<{ role: string; content: string }>,
): string {
  const first = messages.find((m) => m.role === "user");
  if (!first || !first.content.trim()) return "New chat";
  // Take the first line, trimmed
  const line = first.content.trim().split("\n")[0] ?? "New chat";
  return line || "New chat";
}
