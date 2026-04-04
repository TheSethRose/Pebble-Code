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
const SIDEBAR_HORIZONTAL_PADDING = 2;
const SIDEBAR_LABEL_PREFIX_WIDTH = 2;

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
  const [marqueeTick, setMarqueeTick] = React.useState(0);
  const isNewChatSelected = isFocused && selectedIndex === 0;
  const isNewChatActive = activeSessionId === null;
  const selectedTitle = isFocused && selectedIndex > 0
    ? sessions[selectedIndex - 1]?.title ?? ""
    : "";
  const shouldAnimateSelectedTitle = shouldAnimateSessionLabel(selectedTitle, width);

  React.useEffect(() => {
    setMarqueeTick(0);
  }, [selectedIndex, selectedTitle, width, isFocused]);

  React.useEffect(() => {
    if (!shouldAnimateSelectedTitle) {
      return;
    }

    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
      interval = setInterval(() => {
        setMarqueeTick((tick) => tick + 1);
      }, 180);
    }, 500);

    return () => {
      clearTimeout(timeout);
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [shouldAnimateSelectedTitle]);

  return (
    <Box
      flexDirection="column"
      width={width}
      flexGrow={1}
      paddingLeft={1}
      paddingRight={1}
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
        const labelLines = isCursor
          ? [getScrollingSessionLabel(s.title, width, marqueeTick)]
          : wrapSessionLabel(s.title, width);

        return (
          <Box key={s.id} flexDirection="column">
            {labelLines.map((line, lineIndex) => (
              <Text
                key={`${s.id}:${lineIndex}`}
                color={isCursor ? "black" : isActive ? "green" : "gray"}
                backgroundColor={isCursor ? "green" : undefined}
                bold={isCursor || isActive}
              >
                {lineIndex === 0
                  ? `${isActive && !isCursor ? "▸" : " "} ${line}`
                  : `  ${line}`}
              </Text>
            ))}
          </Box>
        );
      })}

      {sessions.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No sessions yet</Text>
        </Box>
      )}

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>{getSidebarHintText(isFocused)}</Text>
      </Box>
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

export function wrapSessionLabel(title: string, width: number): string[] {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return [""];
  }

  const usableWidth = Math.max(8, width - SIDEBAR_HORIZONTAL_PADDING - SIDEBAR_LABEL_PREFIX_WIDTH);
  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
      continue;
    }

    const nextLine = `${currentLine} ${word}`;
    if (nextLine.length <= usableWidth) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

export function getScrollingSessionLabel(title: string, width: number, tick: number): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const usableWidth = getSidebarUsableWidth(width);
  if (normalized.length <= usableWidth) {
    return normalized;
  }

  const spacer = "   ";
  const loop = `${normalized}${spacer}`;
  const offset = tick % loop.length;
  const padded = `${loop}${normalized}${spacer}`;

  return padded.slice(offset, offset + usableWidth);
}

export function shouldAnimateSessionLabel(title: string, width: number): boolean {
  const normalized = title.trim().replace(/\s+/g, " ");
  return normalized.length > getSidebarUsableWidth(width);
}

export function getSidebarHintText(isFocused: boolean): string {
  return isFocused ? "↑↓ move · Enter select · Del remove" : "Press Tab to Select Chat";
}

export function buildVerticalDivider(height: number): string {
  if (height <= 0) return "";
  return Array.from({ length: height }, () => "│").join("\n");
}

function getSidebarUsableWidth(width: number): number {
  return Math.max(8, width - SIDEBAR_HORIZONTAL_PADDING - SIDEBAR_LABEL_PREFIX_WIDTH);
}
