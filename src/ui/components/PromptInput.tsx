import React from "react";
import { Box, Text } from "ink";
import type { ContextAttachmentIndexEntry } from "../contextAttachmentIndex.js";
import { PromptComposerInput } from "./PromptComposerInput.js";

const IS_MAC = process.platform === "darwin";

export interface CommandSuggestion {
  kind: "command";
  name: string;
  description: string;
  aliases?: string[];
  insertText?: string;
}

export interface FileSuggestion extends ContextAttachmentIndexEntry {
  kind: "file";
}

export type PromptSuggestion = CommandSuggestion | FileSuggestion;

interface PromptInputProps {
  isProcessing: boolean;
  disabled?: boolean;
  suspendInputCapture?: boolean;
  onSubmit: (value: string) => void;
  onChange?: (value: string) => void;
  inputKey?: number;
  defaultValue?: string;
  exitWarning?: boolean;
  statusText?: string;
  model?: string;
  sessionId?: string | null;
  width?: number;
  suggestions?: PromptSuggestion[];
  selectedSuggestionIndex?: number;
  emptySuggestionLabel?: string | null;
  voiceEnabled?: boolean;
  voiceState?: "idle" | "recording" | "processing";
  voiceWarmingUp?: boolean;
  voiceAudioLevels?: number[];
  voiceError?: string | null;
  stagedPasteCount?: number;
  onPasteStateChange?: (count: number) => void;
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

function truncateLabel(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value;
  }

  if (maxWidth <= 3) {
    return value.slice(0, maxWidth);
  }

  return `${value.slice(0, maxWidth - 3)}...`;
}

/**
 * The input row pinned to the bottom of the REPL.
 * Styled after the reference prompt shell: a dedicated input bar plus
 * a footer row for state, shortcuts, and lightweight session context.
 */
export function PromptInput({
  isProcessing,
  disabled = false,
  suspendInputCapture = false,
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
  emptySuggestionLabel = null,
  voiceEnabled = false,
  voiceState = "idle",
  voiceWarmingUp = false,
  voiceAudioLevels = [],
  voiceError = null,
  stagedPasteCount = 0,
  onPasteStateChange,
}: PromptInputProps) {
  const isInputSuspended = suspendInputCapture && !disabled;
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
      : stagedPasteCount > 0
        ? `${stagedPasteCount} pasted block${stagedPasteCount === 1 ? "" : "s"} staged`
      : "Ask Pebble anything…";
  const actionHint = voiceState === "recording"
    ? "Release Space to transcribe"
    : voiceState === "processing"
      ? "Pebble will insert the transcript when ready"
      : disabled
        ? "Answer above to continue"
        : stagedPasteCount > 0
          ? "Enter sends the full pasted content"
          : "Enter sends · / commands · @ files";
  const showSuggestionBox = suggestions.length > 0 || Boolean(emptySuggestionLabel);
  const actionColor = voiceState === "recording"
    ? "red"
    : voiceState === "processing" || disabled || isProcessing
      ? "yellow"
      : "cyan";
  const showActionRow = disabled || isProcessing || voiceState !== "idle" || Boolean(voiceError) || stagedPasteCount > 0;
  const footerStatusLabel = isProcessing && !disabled ? "" : statusLabel;
  const suggestionLabelWidth = Math.max(24, Math.min(64, width - 18));
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
      {showSuggestionBox && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          {suggestions.length === 0 ? (
            <Text color="#aaaaaa">{emptySuggestionLabel}</Text>
          ) : suggestions.map((suggestion, i) => {
            const isSelected = i === selectedSuggestionIndex;
            if (suggestion.kind === "file") {
              return (
                <Box key={suggestion.key}>
                  <Text color={isSelected ? "green" : "#aaaaaa"}>
                    {isSelected ? "▶ " : "  "}
                  </Text>
                  <Text color={isSelected ? "green" : "white"} bold={isSelected}>
                    {truncateLabel(`@${suggestion.displayPath}`, suggestionLabelWidth)}
                  </Text>
                </Box>
              );
            }

            return (
              <Box key={`${suggestion.name}:${suggestion.insertText ?? suggestion.name}`}>
                <Text color={isSelected ? "cyan" : "#aaaaaa"}>
                  {isSelected ? "▶ " : "  "}
                </Text>
                <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
                  {("/" + suggestion.name).padEnd(14)}
                </Text>
                {suggestion.aliases && suggestion.aliases.length > 0 ? (
                  <Text dimColor={!isSelected} color={isSelected ? "cyan" : "#aaaaaa"}>
                    {suggestion.aliases.map((alias) => `/${alias}`).join(", ")}{"  "}
                  </Text>
                ) : null}
                <Text dimColor={!isSelected} color={isSelected ? "cyan" : undefined}>
                  {suggestion.description}
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
        ) : isInputSuspended ? (
          <Text color={defaultValue ? "white" : "#666666"}>
            {defaultValue || "Ask Pebble anything…"}
          </Text>
        ) : (
          <PromptComposerInput
            key={`${isProcessing ? "busy" : "idle"}-${inputKey}`}
            defaultValue={defaultValue}
            isDisabled={disabled}
            onSubmit={onSubmit}
            onChange={onChange}
            onPasteStateChange={onPasteStateChange}
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
