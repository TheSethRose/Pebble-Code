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
  width?: number;
}

const SIDEBAR_WIDTH = 24;
const ICON_NEW = "◈";
const ICON_ACTIVE = "▸";
const ICON_INACTIVE = " ";

/**
 * Right sidebar listing saved sessions.
 * Selecting an entry triggers a session switch; the top "New Chat" entry
 * creates a fresh session (id=null).
 */
export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  width = SIDEBAR_WIDTH,
}: SessionSidebarProps) {
  const maxLabel = width - 4; // padding + icon

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor="green"
      paddingX={1}
    >
      {/* New Chat button */}
      <Box>
        <Text
          color={activeSessionId === null ? "green" : "white"}
          bold={activeSessionId === null}
        >
          {ICON_NEW} New Chat
        </Text>
      </Box>

      {/* Session list */}
      {sessions.map((s) => {
        const isActive = s.id === activeSessionId;
        const icon = isActive ? ICON_ACTIVE : ICON_INACTIVE;
        const label =
          s.title.length > maxLabel
            ? s.title.slice(0, maxLabel - 1) + "…"
            : s.title;

        return (
          <Box key={s.id}>
            <Text
              color={isActive ? "green" : "gray"}
              bold={isActive}
            >
              {icon} {label}
            </Text>
          </Box>
        );
      })}

      {sessions.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No sessions yet</Text>
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
