import React from "react";
import { Box, Text } from "ink";
import { MousePressableRegion } from "./MousePressableRegion.js";

export interface DeleteConfirmDialogProps {
  title: string;
  selectedButton: "delete" | "cancel";
  mouseEnabled?: boolean;
  onDelete: () => void;
  onCancel: () => void;
}

interface PressableDialogButtonProps {
  mouseEnabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}

const DELETE_DIALOG_WIDTH = 60;

function PressableDialogButton({ mouseEnabled, onPress, children }: PressableDialogButtonProps) {
  if (!mouseEnabled) {
    return <Box>{children}</Box>;
  }

  return (
    <MousePressableRegion onPress={onPress}>
      <Box>{children}</Box>
    </MousePressableRegion>
  );
}

export function DeleteConfirmDialog({
  title,
  selectedButton,
  mouseEnabled = false,
  onDelete,
  onCancel,
}: DeleteConfirmDialogProps) {
  const quotedTitle = title.length > 30 ? `${title.slice(0, 29)}…` : title;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      paddingX={3}
      paddingY={1}
      width={DELETE_DIALOG_WIDTH}
    >
      <Box marginBottom={1} justifyContent="center">
        <Text bold color="red">Delete session?</Text>
      </Box>
      <Box flexDirection="column" marginBottom={1} alignItems="center">
        <Text color="white">This will permanently delete the current session.</Text>
        <Text color="white">"{quotedTitle}"</Text>
      </Box>
      <Box justifyContent="center" gap={3}>
        <PressableDialogButton mouseEnabled={mouseEnabled} onPress={onDelete}>
          <Text
            color={selectedButton === "delete" ? "white" : "white"}
            backgroundColor="red"
            bold
          >
            {selectedButton === "delete" ? "[ Delete ]" : " Delete "}
          </Text>
        </PressableDialogButton>
        <PressableDialogButton mouseEnabled={mouseEnabled} onPress={onCancel}>
          <Text
            color={selectedButton === "cancel" ? "black" : "gray"}
            backgroundColor={selectedButton === "cancel" ? "white" : undefined}
            bold={selectedButton === "cancel"}
          >
            {selectedButton === "cancel" ? "[ Cancel ]" : " Cancel "}
          </Text>
        </PressableDialogButton>
      </Box>
      <Box flexDirection="column" marginTop={1} alignItems="center">
        <Text dimColor>{mouseEnabled ? "Click a button, or use ← → to switch." : "Use ← → to switch."}</Text>
        <Text dimColor>Enter confirms. Esc cancels.</Text>
      </Box>
    </Box>
  );
}