import React from "react";
import { Box, Text } from "ink";
import { PebbleMascot, type PebbleMood } from "./PebbleMascot.js";

interface WelcomeHeaderProps {
  cwd: string;
  model: string;
  providerLabel?: string;
  sessionId: string | null;
  mascotMood: PebbleMood;
  width?: number;
}

/**
 * Shown only when the conversation is empty (no messages yet).
 * Mirrors the reference's LogoV2 in intent: project context + quick-start hint.
 */
export function WelcomeHeader({ cwd, model, providerLabel, sessionId, mascotMood, width = 80 }: WelcomeHeaderProps) {
  const sessionLabel = sessionId ? `session ${sessionId.slice(0, 8)}` : "new session";
  const modelLine = providerLabel ? `${model} · ${providerLabel}` : model;
  const cardWidth = Math.max(40, width - 2);

  return (
    <Box flexDirection="column" marginBottom={1}>


      <Box
        borderStyle="round"
        borderColor="green"
        paddingX={2}
        paddingY={1}
        width={cardWidth}
        flexDirection="column"
      >
        <Box flexDirection="column" alignItems="center">
          <Text bold>Welcome to Pebble Code</Text>

          <Box marginY={1}>
            <PebbleMascot mood={mascotMood} color="green" layoutWidth={width} />
          </Box>

          <Text dimColor>{modelLine}</Text>
          <Text dimColor>{sessionLabel}</Text>
          <Text dimColor>{cwd}</Text>
        </Box>
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>Type a prompt to start · /help shows commands</Text>
      </Box>
    </Box>
  );
}
