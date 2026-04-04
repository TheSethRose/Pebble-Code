import React from "react";
import { Box, Text } from "ink";

interface JumpToBottomPillProps {
  count?: number;
}

export function JumpToBottomPill({ count = 0 }: JumpToBottomPillProps) {
  const label = count > 0 ? `${count} new ${count === 1 ? "message" : "messages"}` : "Jump to bottom";

  return (
    <Box>
      <Text color="white" backgroundColor="gray" bold>
        {` ${label} ↓ `}
      </Text>
    </Box>
  );
}
