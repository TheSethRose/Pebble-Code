import React from "react";
import { Box, Text } from "ink";
import { TextInput } from "@inkjs/ui";

const IS_MAC = process.platform === "darwin";

export interface CommandSuggestion {
  name: string;
  description: string;
}

interface PromptInputProps {
  isProcessing: boolean;
  disabled?: boolean;
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
  voiceEnabled?: boolean;
  voiceState?: "idle" | "recording" | "processing";
  voiceWarmingUp?: boolean;
  voiceAudioLevels?: number[];
  voiceError?: string | null;
}

function renderVoiceLevels(levels: number[]): string {
  if (levels.length === 0) {
    return "▁▁▁▁";
  }

  const glyphs = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  return levels
    .map((level) => glyphs[Math.min(glyphs.length - 1, Math.max(0, Math.round(level * (glyphs.length - 1))))] ?? "▁")
    .join("");
}

/**
 * The input row pinned to the bottom of the REPL.
 * Styled after the reference prompt shell: a dedicated input bar plus
 * a footer row for state, shortcuts, and lightweight session context.
 */
export function PromptInput({
  isProcessing,
  disabled = false,
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
  voiceEnabled = false,
  voiceState = "idle",
  voiceWarmingUp = false,
  voiceAudioLevels = [],
  voiceError = null,
}: PromptInputProps) {
  const statusLabel = disabled ? statusText || "Waiting for input…" : isProcessing ? statusText || "Working…" : "Ready";
  const promptGlyph = voiceState === "recording" ? "●" : isProcessing || voiceState === "processing" ? "…" : "❯";
  const sessionLabel = sessionId ? sessionId.slice(0, 8) : "new session";
  const rule = "─".repeat(Math.max(24, width - 2));
  const actionLabel = voiceState === "recording"
    ? `Recording… ${renderVoiceLevels(voiceAudioLevels)}`
    : voiceState === "processing"
      ? "Transcribing…"
      : disabled
    ? "Pebble is waiting for your answer…"
    : isProcessing
      ? statusText || "Working…"
      : "Ask Pebble anything…";
  const actionHint = voiceState === "recording"
    ? "Release Space to transcribe"
    : voiceState === "processing"
      ? "Pebble will insert the transcript when ready"
      : disabled
    ? "Answer above to continue"
    : "Enter sends · / shows commands";
  const actionColor = voiceState === "recording"
    ? "red"
    : voiceState === "processing" || disabled || isProcessing
      ? "yellow"
      : "cyan";
  const showActionRow = disabled || isProcessing || voiceState !== "idle" || Boolean(voiceError);
  const footerStatusLabel = isProcessing && !disabled ? "" : statusLabel;
  const footerVoiceHint = voiceEnabled
    ? voiceState === "recording"
      ? "Voice active"
      : voiceState === "processing"
        ? "Voice transcribing"
        : voiceWarmingUp
          ? "Keep holding Space to talk"
          : "Hold Space to talk"
    : null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {suggestions.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          {suggestions.map((s, i) => {
            const isSelected = i === selectedSuggestionIndex;
            return (
              <Box key={s.name}>
                <Text color={isSelected ? "cyan" : "#aaaaaa"}>
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

      <Text color="#aaaaaa">{rule}</Text>

      {showActionRow && (
        <Box justifyContent={actionHint ? "space-between" : "flex-start"} paddingX={1}>
          <Box flexDirection="column">
            <Text color={voiceError ? "yellow" : actionColor} bold>
              {voiceError ?? actionLabel}
            </Text>
          </Box>
          {actionHint ? <Text color="#aaaaaa">{actionHint}</Text> : null}
        </Box>
      )}

      {exitWarning && (
        <Box paddingLeft={1}>
          <Text color="yellow">Press Ctrl+C again to exit</Text>
        </Box>
      )}

      <Box paddingLeft={1}>
        <Text color={isProcessing ? "yellow" : "cyan"} bold>
          {promptGlyph}{" "}
        </Text>
        {disabled ? (
          <Text color="#aaaaaa">Interactive prompt is temporarily paused above.</Text>
        ) : (
          <TextInput
            key={`${isProcessing ? "busy" : "idle"}-${inputKey}`}
            defaultValue={defaultValue}
            onSubmit={onSubmit}
            onChange={onChange}
            placeholder={isProcessing ? "" : "Ask Pebble anything…"}
          />
        )}
      </Box>

      <Text color="#aaaaaa">{rule}</Text>

      <Box justifyContent="space-between" paddingX={1}>
        <Text color={isProcessing || disabled ? "yellow" : "#aaaaaa"}>
          {footerStatusLabel}
          {!isProcessing && !disabled ? ` · Enter sends · Tab ⇄ sessions${footerVoiceHint ? ` · ${footerVoiceHint}` : ""}` : ""}
        </Text>
        <Text color="#aaaaaa">
          {model} · {sessionLabel} · {IS_MAC ? "⌘" : "Ctrl"}+P help
        </Text>
      </Box>
    </Box>
  );
}
