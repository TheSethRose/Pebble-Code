import React from "react";
import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";

// ── Animated spinner for streaming / running states ──────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function useSpinner(active: boolean): string {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [active]);
  return active ? (SPINNER_FRAMES[frame] ?? SPINNER_FRAMES[0]) : "";
}

// ── Streaming cursor blink ───────────────────────────────────────────────────

function useBlinkingCursor(active: boolean): string {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [active]);
  return active && visible ? "▍" : "";
}

// ── Role styles ──────────────────────────────────────────────────────────────

interface RoleStyle {
  marker?: string;
  label?: string;
  color: string;
  dim?: boolean;
  indent?: number;
  backgroundColor?: string;
  textColor?: string;
}

function getRoleStyle(role: string): RoleStyle {
  switch (role) {
    case "user":
      return { marker: ">", color: "white", indent: 0 };
    case "assistant":
      return { marker: "●", color: "white", indent: 0 };
    case "streaming":
      return { label: "∴ Thinking…", color: "gray", dim: true, indent: 2 };
    case "command":
      return { marker: "›", color: "gray", indent: 0, backgroundColor: "gray", textColor: "white" };
    case "output":
      return { marker: "└", color: "gray", dim: true, indent: 2 };
    case "tool":
      return { marker: "⧈", color: "white", indent: 0 };
    case "tool_result":
      return { marker: "✓", color: "green", indent: 0 };
    case "tool_error":
      return { marker: "✗", color: "red", indent: 0 };
    case "error":
      return { marker: "✗", color: "red", indent: 0 };
    case "progress":
      return { marker: "↻", color: "cyan", dim: true, indent: 0 };
    default:
      return { marker: "•", color: "white", indent: 0 };
  }
}

// ── MessageItem ──────────────────────────────────────────────────────────────

interface MessageItemProps {
  message: DisplayMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const { role, content, meta } = message;
  const style = getRoleStyle(role);

  // ── Streaming with blinking cursor ──

  if (role === "streaming") {
    return <StreamingMessage content={content} style={style} />;
  }

  // ── Command echo ──

  if (role === "command") {
    return (
      <Box marginBottom={1} paddingX={1} backgroundColor={style.backgroundColor}>
        <Text color={style.textColor}>{`${style.marker} ${content || "(empty)"}`}</Text>
      </Box>
    );
  }

  // ── User message ──

  if (role === "user") {
    return (
      <Box marginBottom={1}>
        <Box minWidth={2}>
          <Text color={style.color}>{style.marker}</Text>
        </Box>
        <Text color={style.color}>{content || "(empty)"}</Text>
      </Box>
    );
  }

  // ── Tool call (running) ──

  if (role === "tool") {
    return <ToolCallMessage toolName={meta?.toolName ?? content} meta={meta} />;
  }

  // ── Tool result ──

  if (role === "tool_result") {
    const isError = meta?.isError ?? false;
    const toolName = meta?.toolName ?? "";
    const marker = isError ? "✗" : "✓";
    const markerColor = isError ? "red" : "green";
    const label = toolName ? `${toolName} ${isError ? "failed" : "done"}` : content;
    const duration = meta?.durationMs;
    const output = meta?.toolOutput ?? "";
    const outputColor = isError ? "red" : "white";
    return (
      <Box marginBottom={1} paddingLeft={2} flexDirection="column">
        <Box>
          <Box minWidth={2}>
            <Text color={markerColor}>{marker}</Text>
          </Box>
          <Text color={markerColor}>{label}</Text>
          {duration != null && <Text dimColor> ({duration}ms)</Text>}
          {meta?.truncated && <Text dimColor> [truncated]</Text>}
        </Box>
        {!!output && (
          <Box paddingLeft={2}>
            <Text color={outputColor} dimColor={!isError}>{formatBodyPreview(output)}</Text>
          </Box>
        )}
        {meta?.summary && meta.summary !== output && (
          <Box paddingLeft={2}>
            <Text dimColor>{meta.summary}</Text>
          </Box>
        )}
        {meta?.errorMessage && meta.errorMessage !== output && (
          <Box paddingLeft={2}>
            <Text color="red">{meta.errorMessage}</Text>
          </Box>
        )}
        {(meta?.requestedToolName || meta?.qualifiedToolName || meta?.toolCallId) && (
          <Box paddingLeft={2}>
            <Text dimColor>
              {[meta.toolCallId, meta.requestedToolName, meta.qualifiedToolName].filter(Boolean).join(" · ")}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // ── Error messages ──

  if (role === "error" || meta?.isError) {
    return (
      <Box marginBottom={1} paddingLeft={style.indent ?? 0}>
        <Box minWidth={2}>
          <Text color="red" bold>✗</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text color="red" bold>Error</Text>
          <Text color="red">{content}</Text>
        </Box>
      </Box>
    );
  }

  // ── Progress indicator ──

  if (role === "progress") {
    return <ProgressMessage content={content} turnNumber={meta?.turnNumber} />;
  }

  // ── Default (assistant, output, etc.) ──

  return (
    <Box marginBottom={1} paddingLeft={style.indent ?? 0}>
      {style.marker ? (
        <Box minWidth={2}>
          <Text color={style.color} dimColor={style.dim}>
            {style.marker}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1}>
        {style.label ? (
          <Text color={style.color} dimColor={style.dim} italic={style.dim}>
            {style.label}
          </Text>
        ) : null}
        <Text color={style.color} dimColor={style.dim}>
          {content || "(empty)"}
        </Text>
      </Box>
    </Box>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StreamingMessage({ content, style }: { content: string; style: RoleStyle }) {
  const cursor = useBlinkingCursor(true);
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={style.indent ?? 2}>
      <Text color={style.color} dimColor italic>
        ∴ Thinking…
      </Text>
      {!!content && (
        <Box paddingLeft={2}>
          <Text color="white">{content}{cursor}</Text>
        </Box>
      )}
    </Box>
  );
}

function ToolCallMessage({ toolName, meta }: { toolName: string; meta?: DisplayMessage["meta"] }) {
  const spinner = useSpinner(true);
  const argSummary = meta?.toolArgs ? compactArgs(meta.toolArgs) : "";
  const isError = meta?.isError ?? false;
  const color = isError ? "red" : "white";
  return (
    <Box marginBottom={1} paddingLeft={2} flexDirection="column">
      <Box>
        <Box minWidth={2}>
          <Text color={isError ? "red" : "gray"}>{spinner || "⧈"}</Text>
        </Box>
        <Text color={color}>{toolName}</Text>
        {argSummary ? <Text dimColor> {argSummary}</Text> : null}
      </Box>
      {(meta?.requestedToolName || meta?.qualifiedToolName) && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {meta.requestedToolName && meta.requestedToolName !== toolName
              ? `requested as ${meta.requestedToolName}`
              : meta.qualifiedToolName}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function ProgressMessage({ content, turnNumber }: { content: string; turnNumber?: number }) {
  const spinner = useSpinner(true);
  return (
    <Box marginBottom={0} paddingLeft={2}>
      <Box minWidth={2}>
        <Text color="cyan">{spinner || "↻"}</Text>
      </Box>
      {turnNumber != null && (
        <Text dimColor>[turn {turnNumber}] </Text>
      )}
      <Text dimColor>{content}</Text>
    </Box>
  );
}

/** Compact object summary: "command: ls -la, timeout: 30" */
function compactArgs(args: Record<string, unknown>, maxLen = 60): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(args)) {
    const str = typeof val === "string" ? val : JSON.stringify(val);
    parts.push(`${key}: ${str}`);
  }
  const joined = parts.join(", ");
  return joined.length > maxLen ? joined.slice(0, maxLen - 1) + "…" : joined;
}

function formatBodyPreview(value: string, maxLines = 6, maxChars = 600): string {
  const limitedChars = value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
  const lines = limitedChars.split("\n");
  return lines.length > maxLines
    ? `${lines.slice(0, maxLines).join("\n")}\n…`
    : limitedChars;
}
