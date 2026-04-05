import React from "react";
import { Box, Text } from "ink";
import { MousePressableRegion } from "./MousePressableRegion.js";

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
  onSelect: (sessionId: string | null, index: number) => void;
  onRequestDelete?: (session: SessionSummary, index: number) => void;
  selectedIndex: number;
  isFocused: boolean;
  mouseEnabled?: boolean;
  width?: number;
}

interface SidebarRailProps {
  height?: number;
  isFocused: boolean;
}

const SIDEBAR_WIDTH = 30;
const SIDEBAR_HORIZONTAL_PADDING = 2;
const SIDEBAR_LABEL_PREFIX_WIDTH = 2;
const DELETE_BUTTON_SLOT_WIDTH = 3;

interface SidebarSelectableRowProps {
  children: React.ReactNode;
  mouseEnabled: boolean;
  onSelect: () => void;
}

export function SidebarRail({ height, isFocused }: SidebarRailProps) {
  const rows = Math.max(1, height ?? 1);

  return (
    <Box width={1} flexShrink={0}>
      <Text color={isFocused ? "green" : "gray"}>{buildVerticalDivider(rows)}</Text>
    </Box>
  );
}

function SidebarSelectableRow({ children, mouseEnabled, onSelect }: SidebarSelectableRowProps) {
  if (!mouseEnabled) {
    return <Box>{children}</Box>;
  }

  return (
    <MousePressableRegion onPress={onSelect}>
      <Box>{children}</Box>
    </MousePressableRegion>
  );
}

/**
 * Right sidebar listing saved sessions.
 * Index 0 = "New Chat", index 1+ = sessions.
 * When focused, the selected row is highlighted with an inverse cursor.
 */
export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onRequestDelete,
  selectedIndex,
  isFocused,
  mouseEnabled = false,
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
        <Text color="#aaaaaa" bold>
          Chats {isFocused ? "◀" : " "}
        </Text>
      </Box>

      {/* New Chat entry (index 0) */}
      <SidebarSelectableRow mouseEnabled={mouseEnabled} onSelect={() => onSelect(null, 0)}>
        <Text
          color={isNewChatSelected ? "white" : isNewChatActive ? "green" : "white"}
          backgroundColor={isNewChatSelected ? "#333333" : undefined}
          bold={isNewChatSelected || isNewChatActive}
        >
          {buildSidebarRow("◈ New Chat", width)}
        </Text>
      </SidebarSelectableRow>

      {/* Session list */}
      {sessions.map((s, i) => {
        const rowIndex = i + 1; // offset by 1 since "New Chat" is 0
        const isActive = s.id === activeSessionId;
        const isCursor = isFocused && selectedIndex === rowIndex;
        const prefix = isActive && !isCursor ? "▸ " : "  ";
        const label = isCursor
          ? getScrollingSessionLabel(s.title, width, marqueeTick)
          : truncateSessionLabel(s.title, width);
        const labelWidth = Math.max(12, width - DELETE_BUTTON_SLOT_WIDTH);
        const deleteLabel = " x ";

        return (
          <Box key={s.id} flexDirection="row" width={width}>
            <Box flexGrow={1} width={labelWidth}>
              <SidebarSelectableRow
                mouseEnabled={mouseEnabled}
                onSelect={() => onSelect(s.id, rowIndex)}
              >
                <Text
                  color={isCursor ? "white" : isActive ? "#4ade80" : "#aaaaaa"}
                  backgroundColor={isCursor ? "#4a4a4a" : undefined}
                  bold={isCursor || isActive}
                >
                  {buildSidebarRow(label, labelWidth, prefix)}
                </Text>
              </SidebarSelectableRow>
            </Box>

            <Box width={DELETE_BUTTON_SLOT_WIDTH} justifyContent="flex-start">
              {mouseEnabled && onRequestDelete ? (
                <MousePressableRegion onPress={() => onRequestDelete(s, rowIndex)}>
                  <Text>
                    {deleteLabel}
                  </Text>
                </MousePressableRegion>
              ) : (
                <Text dimColor>{" ".repeat(DELETE_BUTTON_SLOT_WIDTH)}</Text>
              )}
            </Box>
          </Box>
        );
      })}

      {sessions.length === 0 && (
        <Box marginTop={1}>
          <Text color="#aaaaaa">No sessions yet</Text>
        </Box>
      )}

      {/* Hint */}
      <Box marginTop={1}>
        <Text color="#aaaaaa">{getSidebarHintText(isFocused, mouseEnabled)}</Text>
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

export function truncateSessionLabel(title: string, width: number): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  return fitSidebarContent(normalized, getSidebarUsableWidth(width));
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

export function getSidebarHintText(isFocused: boolean, mouseEnabled = false): string {
  if (isFocused) {
    return mouseEnabled
      ? "↑↓ move  ⏎ select\nClick to switch · x deletes"
      : "↑↓ move  ⏎ select\nDel to Delete Chats";
  }

  return mouseEnabled ? "→ Tab to Select Chats\nClick chats · x deletes" : "→ Tab to Select Chats";
}

export function buildVerticalDivider(height: number): string {
  if (height <= 0) return "";
  return Array.from({ length: height }, () => "│").join("\n");
}

export function buildSidebarRow(content: string, width: number, prefix = ""): string {
  const availableWidth = Math.max(4, width - SIDEBAR_HORIZONTAL_PADDING - stringWidth(prefix));
  const fitted = fitSidebarContent(content, availableWidth);
  return `${prefix}${fitted}${" ".repeat(Math.max(0, availableWidth - stringWidth(fitted)))}`;
}

function getSidebarUsableWidth(width: number): number {
  return Math.max(8, width - SIDEBAR_HORIZONTAL_PADDING - SIDEBAR_LABEL_PREFIX_WIDTH);
}

function fitSidebarContent(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  if (stringWidth(value) <= width) {
    return value;
  }

  if (width <= 3) {
    return ".".repeat(width);
  }

  return `${[...value].slice(0, width - 3).join("")}...`;
}

function stringWidth(value: string): number {
  return [...value].length;
}
