import React from "react";
import { Box, Text } from "ink";
import { TextInput } from "@inkjs/ui";

interface PromptInputProps {
  isProcessing: boolean;
  onSubmit: (value: string) => void;
  onChange?: (value: string) => void;
  inputKey?: number;
  exitWarning?: boolean;
  statusText?: string;
  model?: string;
  sessionId?: string | null;
  width?: number;
}

/**
 * The input row pinned to the bottom of the REPL.
 * Styled after the reference prompt shell: a dedicated input bar plus
 * a footer row for state, shortcuts, and lightweight session context.
 */
export function PromptInput({
  isProcessing,
  onSubmit,
  onChange,
  inputKey = 0,
  exitWarning = false,
  statusText = "",
  model = "default",
  sessionId = null,
  width = 80,
}: PromptInputProps) {
  const statusLabel = isProcessing ? statusText || "Thinking…" : "Ready";
  const promptGlyph = isProcessing ? "…" : "❯";
  const sessionLabel = sessionId ? sessionId.slice(0, 8) : "new session";
  const rule = "─".repeat(Math.max(24, width - 2));

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{rule}</Text>

      {exitWarning && (
        <Box paddingLeft={1}>
          <Text color="yellow">Press Ctrl+C again to exit</Text>
        </Box>
      )}

      <Box paddingLeft={1}>
        <Text color={isProcessing ? "yellow" : "gray"} bold>
          {promptGlyph}{" "}
        </Text>
        <TextInput
          key={`${isProcessing ? "busy" : "idle"}-${inputKey}`}
          onSubmit={onSubmit}
          onChange={onChange}
          placeholder={isProcessing ? "working…" : "Ask anything or try /help"}
        />
      </Box>

      <Box justifyContent="space-between" paddingX={1}>
        <Text dimColor color={isProcessing ? "yellow" : undefined}>
          {statusLabel}
          {!isProcessing ? " · Enter submits" : ""}
        </Text>
        <Text dimColor>
          {model} · {sessionLabel} · /help
        </Text>
      </Box>
    </Box>
  );
}
