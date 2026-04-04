import React from "react";
import { Box, Text, useInput } from "ink";

const IS_MAC = process.platform === "darwin";
const MOD = IS_MAC ? "⌘" : "Ctrl";

const KEYBINDINGS: Array<{ key: string; description: string; section: string }> = [
  { section: "General", key: "Enter", description: "Submit prompt" },
  { section: "General", key: `${MOD}+P`, description: "Show keybindings" },
  { section: "General", key: "Ctrl+C", description: "Clear input / exit" },
  { section: "General", key: "/help", description: "Show keybindings" },
  { section: "Navigation", key: "Tab", description: "Switch focus: input ↔ sidebar" },
  { section: "Navigation", key: "Escape", description: "Return to input" },
  { section: "Input", key: "↑ / ↓", description: "Cycle prompt history" },
  { section: "Input (typing /)", key: "↑ / ↓", description: "Navigate command suggestions" },
  { section: "Input (typing /)", key: "Tab", description: "Auto-complete command" },
  { section: "Sidebar", key: "↑ / ↓", description: "Move between sessions" },
  { section: "Sidebar", key: "Enter", description: "Switch to selected session" },
  { section: "Sidebar", key: "Delete", description: "Delete selected session" },
];

interface KeybindingsPopupProps {
  onClose: () => void;
  width?: number;
}

export function KeybindingsPopup({ onClose, width = 60 }: KeybindingsPopupProps) {
  useInput((_input, key) => {
    if (key.escape || key.return) {
      onClose();
    }
  });

  let lastSection = "";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={1}
      width={Math.min(width, 62)}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="green">
          Keyboard Shortcuts
        </Text>
      </Box>

      {KEYBINDINGS.map((kb, i) => {
        const showSection = kb.section !== lastSection;
        lastSection = kb.section;

        return (
          <React.Fragment key={`kb-${i}`}>
            {showSection && (
              <Box marginTop={i === 0 ? 0 : 1}>
                <Text bold dimColor>
                  {kb.section}
                </Text>
              </Box>
            )}
            <Box>
              <Box width={22}>
                <Text color="cyan">{kb.key.padEnd(20)}</Text>
              </Box>
              <Text>{kb.description}</Text>
            </Box>
          </React.Fragment>
        );
      })}

      <Box marginTop={1} justifyContent="center">
        <Text dimColor>Press Escape or Enter to close</Text>
      </Box>
    </Box>
  );
}
