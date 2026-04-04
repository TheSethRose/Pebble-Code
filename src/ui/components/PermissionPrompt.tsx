import React from "react";
import { Box, Text, useInput } from "ink";
import type { PendingPermission, PermissionChoice } from "../types.js";

const CHOICES: { label: string; value: PermissionChoice; color: string }[] = [
  { label: "Allow", value: "allow", color: "green" },
  { label: "Deny", value: "deny", color: "red" },
  { label: "Allow Session", value: "allow-session", color: "cyan" },
  { label: "Always Allow", value: "allow-always", color: "yellow" },
];

interface PermissionPromptProps {
  pending: PendingPermission;
  width?: number;
}

export function PermissionPrompt({ pending, width = 60 }: PermissionPromptProps) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  useInput((_input, key) => {
    if (key.leftArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.rightArrow) {
      setSelectedIndex((i) => Math.min(CHOICES.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const choice = CHOICES[selectedIndex];
      if (choice) pending.resolve(choice.value);
      return;
    }
    if (key.escape) {
      pending.resolve("deny");
      return;
    }
  });

  // Summarise the tool arguments (single line, truncated)
  const argSummary = summariseArgs(pending.toolArgs, Math.max(20, width - 12));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      width={Math.min(width, 72)}
    >
      <Box marginBottom={1}>
        <Text bold color="yellow">⚠  Permission Required</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text>
          <Text bold>{pending.toolName}</Text>{" "}
          <Text dimColor>wants to run:</Text>
        </Text>
        <Box paddingLeft={2} marginTop={0}>
          <Text color="white">{pending.approvalMessage}</Text>
        </Box>
      </Box>

      {argSummary && (
        <Box marginBottom={1} paddingLeft={2}>
          <Text dimColor>{argSummary}</Text>
        </Box>
      )}

      <Box gap={2}>
        {CHOICES.map((choice, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Text
              key={choice.value}
              color={isSelected ? choice.color : "gray"}
              bold={isSelected}
              underline={isSelected}
            >
              {choice.label}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>← → select · Enter confirm · Esc deny</Text>
      </Box>
    </Box>
  );
}

function summariseArgs(args: Record<string, unknown>, maxLen: number): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  const parts: string[] = [];
  for (const key of keys) {
    const val = args[key];
    const str = typeof val === "string" ? val : JSON.stringify(val);
    parts.push(`${key}: ${str}`);
  }
  const joined = parts.join(", ");
  return joined.length > maxLen ? joined.slice(0, maxLen - 1) + "…" : joined;
}
