import React from "react";
import { Box, Text, useInput } from "ink";
import type { PendingQuestion } from "../types.js";

interface QuestionPromptProps {
  pending: PendingQuestion;
  width?: number;
}

export function QuestionPrompt({ pending, width = 60 }: QuestionPromptProps) {
  const optionCount = pending.options.length;
  const hasCustomChoice = pending.allowFreeform;
  const customIndex = hasCustomChoice ? optionCount : -1;
  const [selectedIndex, setSelectedIndex] = React.useState(optionCount > 0 ? 0 : customIndex);
  const [customValue, setCustomValue] = React.useState("");

  useInput((input, key) => {
    if (key.leftArrow || key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.rightArrow || key.downArrow) {
      const maxIndex = hasCustomChoice ? optionCount : Math.max(0, optionCount - 1);
      setSelectedIndex((index) => Math.min(maxIndex, index + 1));
      return;
    }

    if (key.return) {
      if (selectedIndex >= 0 && selectedIndex < optionCount) {
        pending.resolve(pending.options[selectedIndex] ?? "");
        return;
      }

      if (!pending.allowFreeform) {
        return;
      }

      const value = customValue.trim();
      if (value.length > 0) {
        pending.resolve(value);
      }
      return;
    }

    if (key.escape) {
      pending.resolve("");
      return;
    }

    if (!pending.allowFreeform || selectedIndex !== customIndex) {
      return;
    }

    if (key.backspace || key.delete) {
      setCustomValue((value) => value.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input.length > 0) {
      setCustomValue((value) => value + input);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      width={Math.min(width, 80)}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">? Input needed</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>{pending.question}</Text>
      </Box>

      {pending.options.length > 0 && (
        <Box flexDirection="column" marginBottom={pending.allowFreeform ? 1 : 0}>
          {pending.options.map((option, index) => {
            const isSelected = selectedIndex === index;
            return (
              <Box key={`${option}-${index}`}>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "▶ " : "  "}</Text>
                <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>{option}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {pending.allowFreeform && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={selectedIndex === customIndex ? "cyan" : "gray"} bold={selectedIndex === customIndex}>
            {selectedIndex === customIndex ? "▶ " : "  "}Custom response
          </Text>
          <Box paddingLeft={2}>
            <Text color={selectedIndex === customIndex ? "white" : "gray"}>
              {customValue || "Type your answer here"}
            </Text>
          </Box>
        </Box>
      )}

      <Box>
        <Text dimColor>
          {pending.options.length > 0 ? "← → choose" : "Type to answer"} · Enter confirm · Esc submits empty response
        </Text>
      </Box>
    </Box>
  );
}