import React from "react";
import { Box, Text } from "ink";
import { TextInput } from "@inkjs/ui";

export interface CommandSuggestion {
  name: string;
  description: string;
}

interface PromptInputProps {
  isProcessing: boolean;
  onSubmit: (value: string) => void;
  onChange?: (value: string) => void;
  inputKey?: number;
  defaultValue?: string;
  exitWarning?: boolean;
  statusText?: string;
  model?: string;
  sessionId?: string | null;
  width?: number;
  suggestions?: CommandSuggestion[];
  selectedSuggestionIndex?: number;
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
  defaultValue = "",
  exitWarning = false,
  statusText = "",
  model = "default",
  sessionId = null,
  width = 80,
  suggestions = [],
  selectedSuggestionIndex = 0,
}: PromptInputProps) {
  const statusLabel = isProcessing ? statusText || "Thinking…" : "Ready";
  const promptGlyph = isProcessing ? "…" : "❯";
  const sessionLabel = sessionId ? sessionId.slice(0, 8) : "new session";
  const rule = "─".repeat(Math.max(24, width - 2));

  return (
    <Box flexDirection="column" marginTop={1}>
      {suggestions.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          {suggestions.map((s, i) => {
            const isSelected = i === selectedSuggestionIndex;
            return (
              <Box key={s.name}>
                <Text color={isSelected ? "cyan" : "gray"}>
                  {isSelected ? "▶ " : "  "}
                </Text>
                <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
                  {("/" + s.name).padEnd(14)}
                </Text>
                <Text dimColor={!isSelected} color={isSelected ? "cyan" : undefined}>
                  {s.description}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

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
          defaultValue={defaultValue}
          onSubmit={onSubmit}
          onChange={onChange}
          placeholder={isProcessing ? "working…" : "Ask anything or try /help"}
        />
      </Box>

      <Box justifyContent="space-between" paddingX={1}>
        <Text dimColor color={isProcessing ? "yellow" : undefined}>
          {statusLabel}
          {!isProcessing ? " · Enter submits · Tab ⇄ sessions" : ""}
        </Text>
        <Text dimColor>
          {model} · {sessionLabel} · /help
        </Text>
      </Box>
    </Box>
  );
}
