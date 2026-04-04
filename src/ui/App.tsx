import React from "react";
import { render, Text, Box } from "ink";
import { TextInput } from "@inkjs/ui";
import { CommandRegistry } from "../commands/registry";
import { registerBuiltinCommands } from "../commands/builtins";
import type { CommandContext } from "../commands/types";

interface AppState {
  messages: Array<{ role: string; content: string }>;
  isProcessing: boolean;
  exitCode: number | null;
}

export function App({ context }: { context: CommandContext }) {
  const [state, setState] = React.useState<AppState>({
    messages: [],
    isProcessing: false,
    exitCode: null,
  });

  const registry = React.useMemo(() => {
    const reg = new CommandRegistry();
    registerBuiltinCommands(reg);
    return reg;
  }, []);

  const handleSubmit = React.useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      // Check if it's a command
      if (registry.isCommand(trimmed)) {
        const parsed = registry.parseCommand(trimmed);
        if (parsed) {
          const result = await registry.execute(
            parsed.name,
            parsed.args,
            context,
          );
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "command", content: `/${parsed.name} ${parsed.args}` },
              { role: "output", content: result.output },
            ],
            exitCode: result.exit ? 0 : prev.exitCode,
          }));
          if (result.exit) {
            process.exit(0);
          }
        }
        return;
      }

      // Regular prompt - send to engine (stub)
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: "user", content: trimmed },
          {
            role: "assistant",
            content: "(Engine not yet connected — Phase 2 integration)",
          },
        ],
      }));
    },
    [registry, context],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        {state.messages.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            {msg.role === "user" && (
              <Text bold>You: </Text>
            )}
            {msg.role === "command" && (
              <Text color="cyan">{msg.content}</Text>
            )}
            {msg.role === "output" && (
              <Text>{msg.content}</Text>
            )}
            {msg.role === "assistant" && (
              <Text color="green">{msg.content}</Text>
            )}
          </Box>
        ))}
      </Box>
      <Box>
        <Text bold>{"> "} </Text>
        <TextInput onSubmit={handleSubmit} placeholder="Type a message or /help" />
      </Box>
    </Box>
  );
}

export function startREPL(context: CommandContext): Promise<number> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <App context={context} />,
      {
        exitOnCtrlC: false,
      }
    );

    // Handle cleanup
    process.on("SIGINT", () => {
      unmount();
      resolve(0);
    });
  });
}
