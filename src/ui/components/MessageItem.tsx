import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";

interface RoleStyle {
  marker?: string;
  label?: string;
  color: string;
  dim?: boolean;
  indent?: number;
  backgroundColor?: string;
  textColor?: string;
}

function getRoleStyle(role: string): RoleStyle {
  switch (role) {
    case "user":
      return {
        marker: ">",
        color: "white",
        indent: 0,
      };
    case "assistant":
      return { marker: "●", color: "white", indent: 0 };
    case "streaming":
      return { label: "∴ Thinking…", color: "gray", dim: true, indent: 2 };
    case "command":
      return { marker: "›", color: "gray", indent: 0, backgroundColor: "gray", textColor: "white" };
    case "output":
      return { marker: "└", color: "gray", dim: true, indent: 2 };
    case "tool":
      return { marker: "⧈", color: "yellow", indent: 0 };
    case "tool_result":
      return { marker: "✓", color: "green", indent: 0 };
    default:
      return { marker: "•", color: "white", indent: 0 };
  }
}

interface MessageItemProps {
  message: DisplayMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const {
    marker,
    label,
    color,
    dim = false,
    indent = 0,
    backgroundColor,
    textColor,
  } = getRoleStyle(message.role);

  if (message.role === "command") {
    return (
      <Box marginBottom={1} paddingX={1} backgroundColor={backgroundColor}>
        <Text color={textColor}>{`${marker} ${message.content || "(empty)"}`}</Text>
      </Box>
    );
  }

  if (message.role === "user") {
    return (
      <Box marginBottom={1}>
        <Box minWidth={2}>
          <Text color={color}>{marker}</Text>
        </Box>
        <Text color={color}>{message.content || "(empty)"}</Text>
      </Box>
    );
  }

  if (message.role === "streaming") {
    return (
      <Box flexDirection="column" marginBottom={1} paddingLeft={indent}>
        <Text color={color} dimColor={dim} italic>
          {label}
        </Text>
        {!!message.content && (
          <Box paddingLeft={2}>
            <Text color={color} dimColor={dim}>
              {message.content}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box marginBottom={1} paddingLeft={indent}>
      {marker ? (
        <Box minWidth={2}>
          <Text color={color} dimColor={dim}>
            {marker}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1}>
        {label ? (
          <Text color={color} dimColor={dim} italic={dim}>
            {label}
          </Text>
        ) : null}
        <Text color={color} dimColor={dim}>
          {message.content || "(empty)"}
        </Text>
      </Box>
    </Box>
  );
}
