import React from "react";
import { Box, Text } from "ink";

export const PEBBLE_ASCII_LOGO_LINES = [
  "██████╗ ███████╗██████╗ ██████╗ ██╗     ███████╗",
  "██╔══██╗██╔════╝██╔══██╗██╔══██╗██║     ██╔════╝",
  "██████╔╝█████╗  ██████╔╝██████╔╝██║     █████╗  ",
  "██╔═══╝ ██╔══╝  ██╔══██╗██╔══██╗██║     ██╔══╝  ",
  "██║     ███████╗██████╔╝██████╔╝███████╗███████╗",
  "╚═╝     ╚══════╝╚═════╝ ╚═════╝ ╚══════╝╚══════╝",
] as const;

const LOGO_WIDTH = Math.max(...PEBBLE_ASCII_LOGO_LINES.map((line) => line.length));

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  const visible = maxLength - 1;
  const left = Math.ceil(visible / 2);
  const right = Math.floor(visible / 2);
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

interface WelcomeHeaderProps {
  cwd: string;
  model: string;
  providerLabel?: string;
  sessionId: string | null;
  width?: number;
}

/**
 * Persistent top header for the Pebble TUI.
 * Shows the ASCII logo with metadata beneath.
 */
export function WelcomeHeader({ cwd, model, providerLabel, sessionId, width = 80 }: WelcomeHeaderProps) {
  const sessionLabel = sessionId ? `session ${sessionId.slice(0, 8)}` : "new session";
  const modelLine = providerLabel ? `${model} · ${providerLabel}` : model;
  const metadataLine = `${modelLine} • ${sessionLabel}`;
  const cwdLine = truncateMiddle(cwd, Math.max(28, width - 4));

  return (
    <Box flexDirection="column" marginTop={2} marginBottom={1}>
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          {PEBBLE_ASCII_LOGO_LINES.map((line, index) => (
            <Text key={`pebble-logo-${index}`} color="green" bold>
              {line}
            </Text>
          ))}
        </Box>

        <Box paddingLeft={1} flexDirection="column">
          <Text dimColor>{metadataLine}</Text>
          <Text dimColor>{cwdLine}</Text>
        </Box>
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>Type a prompt to start · /help shows commands</Text>
      </Box>
    </Box>
  );
}
