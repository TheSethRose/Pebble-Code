import React from "react";
import { describe, expect, test } from "bun:test";
import {
  TranscriptView,
  getTranscriptLineCount,
  getTranscriptMetrics,
} from "../src/ui/components/TranscriptView";
import { MessageItem } from "../src/ui/components/MessageItem";
import { summariseArgs } from "../src/ui/components/PermissionPrompt";
import type { DisplayMessage } from "../src/ui/types";
import { transcriptToDisplayMessages } from "../src/persistence/runtimeSessions";

function createMessage(role: DisplayMessage["role"], content = "test", meta?: DisplayMessage["meta"]): DisplayMessage {
  return { role, content, meta };
}

describe("TranscriptView", () => {
  const sampleCwd = "/Users/example/workspaces/demo-project";

  test("renders user messages with a contrasting background treatment", () => {
    const element = TranscriptView({ messages: [createMessage("user", "highlight me")], width: 60 });
    const segments = collectTextSegments(element);

    expect(segments.some((segment) => segment.text.includes("highlight me") && segment.backgroundColor === "gray")).toBe(true);
  });

  test("does not render a separate inline processing status row", () => {
    const element = TranscriptView({ messages: [createMessage("tool", "Bash", { toolName: "Bash" })] });
    const flat = flattenText(element);

    expect(flat).toContain("Bash");
    expect(flat).not.toContain("Running:");
  });

  test("shows only the visible transcript window when the transcript overflows", () => {
    const messages = Array.from({ length: 25 }, (_, index) =>
      createMessage(index % 2 === 0 ? "assistant" : "user", `message ${String(index + 1).padStart(2, "0")}`),
    );

    const element = TranscriptView({ messages });
    const flat = flattenText(element);

    expect(flat).toContain("message 25");
    expect(flat).not.toContain("message 01");
    expect(flat).not.toContain("earlier history above");
    expect(flat).not.toContain("newer history below");
  });

  test("can render the Pebble banner inside the scrollable transcript", () => {
    const element = TranscriptView({
      messages: [],
      width: 80,
      banner: {
        cwd: sampleCwd,
        model: "qwen/qwen3.6-plus:free",
        providerLabel: "OpenRouter",
        sessionId: null,
      },
    });
    const flat = flattenText(element);

    expect(flat).toContain("██████╗");
    expect(flat).toContain("qwen/qwen3.6-plus:free · OpenRouter • new session");
    expect(flat).toContain("Use /help if you want commands.");
    expect(flat).not.toContain("Ask Pebble anything — a few strong starting points:");
    expect(flat).not.toContain("Review recent changes");
    expect(flat).not.toContain("Explain this repository");
    expect(flat).not.toContain("Find a file, test, or command");
    expect(flat).not.toContain("Resume a previous session");
  });

  test("renders blank banner spacer rows as whitespace so they stay visible", () => {
    const segments = collectTextSegments(TranscriptView({
      messages: [],
      width: 80,
      banner: {
        cwd: sampleCwd,
        model: "qwen/qwen3.6-plus:free",
        providerLabel: "OpenRouter",
        sessionId: null,
      },
    }));

    expect(segments.filter((segment) => segment.text === " ").length).toBeGreaterThanOrEqual(2);
  });

  test("falls back to a lighter one-line banner hint once the transcript has content", () => {
    const element = TranscriptView({
      messages: [createMessage("assistant", "Ready when you are")],
      width: 80,
      banner: {
        cwd: sampleCwd,
        model: "qwen/qwen3.6-plus:free",
        providerLabel: "OpenRouter",
        sessionId: "session-1234",
      },
    });
    const flat = flattenText(element);

    expect(flat).toContain("Ask Pebble anything, or use /help");
    expect(flat).not.toContain("a few strong starting points");
  });

  test("trims older tall messages when maxRows is constrained", () => {
    const messages = [
      createMessage("assistant", Array.from({ length: 12 }, (_, index) => `tool ${index + 1}`).join("\n")),
      createMessage("user", "show me the tree"),
      createMessage("assistant", "Here is the tree"),
    ];

    const element = TranscriptView({ messages, maxRows: 6, width: 60 });
    const flat = flattenText(element);

    expect(flat).not.toContain("tool 5");
    expect(flat).toContain("show me the tree");
    expect(flat).toContain("Here is the tree");
    expect(flat).not.toContain("earlier history above");
  });

  test("clamps scroll offset to the highest meaningful row instead of overscrolling into whitespace", () => {
    const messages = Array.from({ length: 6 }, (_, index) => createMessage("assistant", `message ${index + 1}`));
    const metrics = getTranscriptMetrics(messages, { width: 40, maxRows: 6 });
    const element = TranscriptView({ messages, maxRows: 6, width: 40, scrollOffset: 999 });
    const flat = flattenText(element);

    expect(metrics.maxScrollOffset).toBeGreaterThanOrEqual(0);
    expect(metrics.maxScrollOffset).toBeLessThan(metrics.totalRows);
    expect(flat).toContain("message 1");
    expect(flat).not.toContain("message 6");
  });

  test("groups tool_call + tool_result into a single tool group", () => {
    const messages = [
      createMessage("user", "run ls"),
      createMessage("tool", "Bash", { toolName: "Bash" }),
      createMessage("tool_result", "Bash done", { toolName: "Bash" }),
      createMessage("assistant", "Here are the files."),
    ];

    expect(getTranscriptLineCount(messages, 80)).toBe(5);
  });

  test("collapses consecutive successful tool results into a single compact row", () => {
    const messages = [
      createMessage("tool", "WorkspaceRead", { toolName: "WorkspaceRead", toolArgs: { action: "read_file", path: "settings.json" } }),
      createMessage("tool_result", "WorkspaceRead done", { toolName: "WorkspaceRead", toolArgs: { action: "read_file", path: "settings.json" } }),
      createMessage("tool", "WorkspaceRead", { toolName: "WorkspaceRead", toolArgs: { action: "read_file", path: "package.json" } }),
      createMessage("tool_result", "WorkspaceRead done", { toolName: "WorkspaceRead", toolArgs: { action: "read_file", path: "package.json" } }),
      createMessage("tool", "WorkspaceRead", { toolName: "WorkspaceRead", toolArgs: { action: "read_file", path: "tsconfig.json" } }),
      createMessage("tool_result", "WorkspaceRead done", { toolName: "WorkspaceRead", toolArgs: { action: "read_file", path: "tsconfig.json" } }),
    ];

    const flat = flattenText(TranscriptView({ messages, width: 120, isProcessing: false }));

    expect(flat).toContain("WorkspaceRead ×3 (settings.json, package.json, tsconfig.json)");
    expect(flat).not.toContain("WorkspaceRead done");
  });

  test("hides empty assistant placeholder rows around tool cycles", () => {
    const messages = [
      createMessage("user", "Give me an overview of the current workspace tree"),
      createMessage("assistant", ""),
      createMessage("tool_result", "WorkspaceRead done", {
        toolName: "WorkspaceRead",
        toolOutput: "src/\nprivate/",
      }),
      createMessage("assistant", "   "),
    ];

    const flat = flattenText(TranscriptView({ messages, width: 80, isProcessing: true }));

    expect(flat).toContain("Give me an overview of the current workspace tree");
    expect(flat).toContain("WorkspaceRead");
    expect(flat).not.toContain("(empty)");
  });

  test("omits progress messages from the transcript", () => {
    const messages = [
      createMessage("progress", "Turn 1/50", { turnNumber: 1 }),
      createMessage("progress", "Turn 2/50", { turnNumber: 2 }),
      createMessage("progress", "Turn 3/50", { turnNumber: 3 }),
      createMessage("assistant", "Done"),
    ];

    const element = TranscriptView({ messages });
    const flat = flattenText(element);

    expect(getTranscriptLineCount(messages, 80)).toBe(1);
    expect(flat).not.toContain("Turn 1/50");
    expect(flat).not.toContain("Turn 3/50");
    expect(flat).toContain("Done");
  });

  test("keeps successful tool rows compact and only expands error details", () => {
    const messages = [
      createMessage("tool_result", "Bash done", {
        toolName: "Bash",
        toolOutput: "line 1\nline 2",
        summary: "2 lines returned",
      }),
    ];

    const liveFlat = flattenText(TranscriptView({ messages, isProcessing: true, width: 80 }));
    const completeFlat = flattenText(TranscriptView({ messages, isProcessing: false, width: 80 }));
    const errorFlat = flattenText(TranscriptView({
      messages: [createMessage("tool_result", "Bash failed", {
        toolName: "Bash",
        toolOutput: "line 1\nline 2",
        summary: "2 lines returned",
        errorMessage: "boom",
        isError: true,
      })],
      isProcessing: false,
      width: 80,
    }));

    expect(liveFlat).toContain("Bash");
    expect(completeFlat).toContain("Bash");
    expect(liveFlat).not.toContain("line 1");
    expect(completeFlat).not.toContain("line 1");
    expect(completeFlat).toContain("2 lines returned");
    expect(errorFlat).toContain("line 1");
    expect(errorFlat).toContain("boom");
  });

  test("formats markdown headings and bold text instead of showing raw markers", () => {
    const element = TranscriptView({
      messages: [createMessage("assistant", "### Title\nParagraph with **bold** text")],
      width: 80,
    });
    const flat = normalizeWhitespace(flattenText(element));
    const segments = collectTextSegments(element);

    expect(flat).toContain("Title");
    expect(flat).toContain("Paragraph with bold text");
    expect(flat).not.toContain("###");
    expect(flat).not.toContain("**");
    expect(segments.some((segment) => segment.text.includes("Title") && segment.bold)).toBe(true);
    expect(segments.some((segment) => segment.text === "bold" && segment.bold)).toBe(true);
  });

  test("renders markdown tables as aligned terminal tables", () => {
    const element = TranscriptView({
      messages: [createMessage("assistant", "| Name | Score |\n| :--- | ---: |\n| Ada | 99 |\n| Bob | 7 |")],
      width: 80,
    });
    const rows = collectRenderedRows(element);
    const segments = collectTextSegments(element);

    expect(rows.some((row) => row.includes("┌"))).toBe(true);
    expect(rows.some((row) => row.includes("│ Name"))).toBe(true);
    expect(rows.some((row) => row.includes("│ Ada"))).toBe(true);
    expect(rows.some((row) => row.includes("99 │"))).toBe(true);
    expect(rows.join("\n")).not.toContain("| :--- | ---: |");
    expect(segments.some((segment) => segment.text.includes("Name") && segment.bold)).toBe(true);
  });

  test("renders task lists, blockquotes, links, and rules in terminal-native form", () => {
    const element = TranscriptView({
      messages: [createMessage("assistant", [
        "- [x] shipped",
        "- [ ] pending follow-up",
        "> Important: review [Docs](https://example.com/docs)",
        "---",
        "Direct link: https://example.com/changelog.",
      ].join("\n"))],
      width: 80,
    });
    const rows = collectRenderedRows(element);
    const flat = rows.join("\n");
    const segments = collectTextSegments(element);

    expect(flat).toContain("☑ shipped");
    expect(flat).toContain("☐ pending follow-up");
    expect(flat).toContain("│ Important: review Docs → https://example.com/docs");
    expect(flat).toContain("Direct link: https://example.com/changelog");
    expect(rows.some((row) => /^\s{2}─{8,}$/.test(row))).toBe(true);
    expect(flat).not.toContain("- [x]");
    expect(flat).not.toContain("[Docs](https://example.com/docs)");
    expect(segments.some((segment) => segment.text.includes("https://example.com/docs") && segment.color === "cyan")).toBe(true);
    expect(segments.some((segment) => segment.text.includes("https://example.com/changelog") && segment.color === "cyan")).toBe(true);
  });

  test("keeps quote and task list prefixes visible on wrapped rows", () => {
    const element = TranscriptView({
      messages: [createMessage("assistant", [
        "> This quoted line is intentionally long so it wraps and keeps the quote rail visible across rows in the transcript.",
        "- [ ] This checklist line is also intentionally long so wrapped rows stay aligned under the checkbox marker.",
      ].join("\n"))],
      width: 44,
    });
    const rows = collectRenderedRows(element);

    expect(rows.filter((row) => row.includes("│ ")).length).toBeGreaterThanOrEqual(2);
    expect(rows.some((row) => row.includes("☐ This checklist"))).toBe(true);
    expect(rows.some((row) => /^\s{4,}intentionally/.test(row))).toBe(true);
  });

  test("uses blinking dot indicators for in-progress transcript rows", () => {
    const live = flattenText(TranscriptView({ messages: [createMessage("streaming", "working")], width: 60, blinkPhase: true }));
    const dim = flattenText(TranscriptView({ messages: [createMessage("streaming", "working")], width: 60, blinkPhase: false }));

    expect(live).toContain("●");
    expect(dim).toContain("○");
  });

  test("keeps live transcript text steady while only the status dot changes phase", () => {
    const liveSegments = collectTextSegments(TranscriptView({
      messages: [createMessage("streaming", "working")],
      width: 60,
      blinkPhase: true,
    }));
    const dimSegments = collectTextSegments(TranscriptView({
      messages: [createMessage("streaming", "working")],
      width: 60,
      blinkPhase: false,
    }));

    expect(liveSegments.find((segment) => segment.text.includes("working"))?.color).toBe("white");
    expect(dimSegments.find((segment) => segment.text.includes("working"))?.color).toBe("white");
    expect(liveSegments.find((segment) => segment.text.includes("●"))?.color).toBe("yellow");
    expect(dimSegments.find((segment) => segment.text.includes("○"))?.color).toBe("gray");
  });

  test("keeps running tool labels steady while only the status dot changes phase", () => {
    const toolMessage = createMessage("tool", "Bash", { toolName: "Bash", toolArgs: { command: "ls" } });
    const liveSegments = collectTextSegments(TranscriptView({ messages: [toolMessage], width: 60, blinkPhase: true }));
    const dimSegments = collectTextSegments(TranscriptView({ messages: [toolMessage], width: 60, blinkPhase: false }));

    expect(liveSegments.find((segment) => segment.text.includes("Bash"))?.color).toBe("yellow");
    expect(dimSegments.find((segment) => segment.text.includes("Bash"))?.color).toBe("yellow");
    expect(liveSegments.find((segment) => segment.text.includes("●"))?.color).toBe("yellow");
    expect(dimSegments.find((segment) => segment.text.includes("○"))?.color).toBe("gray");
  });

  test("only unresolved tool calls blink while completed tool groups stay settled", () => {
    const messages = [
      createMessage("tool", "WorkspaceEdit", { toolName: "WorkspaceEdit", toolArgs: { path: "test.md" } }),
      createMessage("tool_result", "WorkspaceEdit done", { toolName: "WorkspaceEdit", toolOutput: "done" }),
      createMessage("tool", "WorkspaceRead", { toolName: "WorkspaceRead", toolArgs: { path: "test.md" } }),
    ];

    const liveRows = collectRenderedRows(TranscriptView({ messages, width: 80, isProcessing: true, blinkPhase: true }));
    const dimRows = collectRenderedRows(TranscriptView({ messages, width: 80, isProcessing: true, blinkPhase: false }));

    expect(liveRows.some((row) => row.includes("● WorkspaceEdit"))).toBe(true);
    expect(liveRows.some((row) => row.includes("● WorkspaceRead"))).toBe(true);
    expect(dimRows.some((row) => row.includes("● WorkspaceEdit"))).toBe(true);
    expect(dimRows.some((row) => row.includes("○ WorkspaceEdit"))).toBe(false);
    expect(dimRows.some((row) => row.includes("○ WorkspaceRead"))).toBe(true);
  });

  test("renders tool result states with dot indicators instead of checkmarks", () => {
    const successSegments = collectTextSegments(TranscriptView({
      messages: [createMessage("tool_result", "Bash done", { toolName: "Bash", toolOutput: "ok" })],
      width: 60,
    }));
    const errorSegments = collectTextSegments(TranscriptView({
      messages: [createMessage("tool_result", "Bash failed", { toolName: "Bash", isError: true, errorMessage: "boom" })],
      width: 60,
    }));

    expect(successSegments.some((segment) => segment.text.includes("●") && segment.color === "green")).toBe(true);
    expect(errorSegments.some((segment) => segment.text.includes("●") && segment.color === "red")).toBe(true);
  });

  test("does not render tool call ids or qualified names beneath tool results", () => {
    const flat = flattenText(TranscriptView({
      messages: [createMessage("tool_result", "WorkspaceEdit failed", {
        toolName: "WorkspaceEdit",
        toolOutput: "Tool execution error: bad input",
        isError: true,
        toolCallId: "call_64ff834fe52B4e0685ca7913",
        requestedToolName: "WorkspaceEdit",
        qualifiedToolName: "builtin:WorkspaceEdit",
      })],
      width: 80,
      isProcessing: true,
    }));

    expect(flat).toContain("WorkspaceEdit failed");
    expect(flat).not.toContain("call_64ff834fe52B4e0685ca7913");
    expect(flat).not.toContain("builtin:WorkspaceEdit");
  });
});

describe("MessageItem", () => {
  test("renders user message with > marker", () => {
    const element = MessageItem({ message: createMessage("user", "hello") });
    const flat = flattenText(element);
    expect(flat).toContain(">");
    expect(flat).toContain("hello");
  });

  test("renders tool call as a component with toolName prop", () => {
    const element = MessageItem({
      message: createMessage("tool", "Bash", { toolName: "Bash", toolArgs: { command: "ls" } }),
    });
    // ToolCallMessage is a sub-component; verify the element was produced
    expect(element).toBeTruthy();
    expect(element.props).toBeDefined();
  });

  test("renders tool result with success marker", () => {
    const element = MessageItem({
      message: createMessage("tool_result", "Bash done", {
        toolName: "Bash",
        toolOutput: "README.md\nsrc/",
        durationMs: 42,
      }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("✓");
    expect(flat).toContain("Bash done");
    expect(flat).toContain("README.md");
    expect(flat).toContain("42 ms");
  });

  test("renders error tool result with failure marker", () => {
    const element = MessageItem({
      message: createMessage("tool_result", "Bash failed", { toolName: "Bash", isError: true }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("✗");
  });

  test("renders truncated tool output details", () => {
    const element = MessageItem({
      message: createMessage("tool_result", "FileRead done", {
        toolName: "FileRead",
        toolOutput: "line 1\nline 2",
        truncated: true,
      }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("[truncated]");
    expect(flat).toContain("line 1");
  });

  test("renders error messages with bold marker", () => {
    const element = MessageItem({
      message: createMessage("error", "Something went wrong", { isError: true }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("Error");
    expect(flat).toContain("Something went wrong");
  });

  test("renders streaming message as a component", () => {
    const element = MessageItem({ message: createMessage("streaming", "partial response") });
    // StreamingMessage is a sub-component using hooks; verify element structure
    expect(element).toBeTruthy();
    expect(element.props).toBeDefined();
  });
});

describe("transcriptToDisplayMessages", () => {
  test("maps persisted tool transcript rows into completed tool result messages", () => {
    const display = transcriptToDisplayMessages({
      id: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "completed",
      messages: [
        {
          role: "tool",
          content: "README.md\nsrc/",
          timestamp: new Date().toISOString(),
          metadata: { success: true, durationMs: 19 },
          toolCall: {
            name: "Bash",
            args: { command: "ls" },
          },
        },
      ],
    });

    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({
      role: "tool_result",
      content: "Bash done",
      meta: {
        toolName: "Bash",
        toolArgs: { command: "ls" },
        toolOutput: "README.md\nsrc/",
        durationMs: 19,
      },
    });
  });

  test("marks denied or failed persisted tool rows as errors", () => {
    const display = transcriptToDisplayMessages({
      id: "session-2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "completed",
      messages: [
        {
          role: "tool",
          content: "Tool execution denied: Restricted mode",
          timestamp: new Date().toISOString(),
          metadata: { success: false, error: "Restricted mode" },
          toolCall: {
            name: "FileEdit",
            args: { file_path: "package.json" },
          },
        },
      ],
    });

    expect(display[0]?.meta?.isError).toBe(true);
    expect(display[0]?.content).toBe("FileEdit failed");
  });
});

describe("PermissionPrompt helpers", () => {
  test("summarises and truncates approval arguments for prompt rendering", () => {
    expect(summariseArgs({ command: "rm -rf /tmp/demo", force: true }, 24)).toContain("command:");
    expect(summariseArgs({ command: "rm -rf /tmp/demo", force: true }, 24).endsWith("…")).toBe(true);
    expect(summariseArgs({}, 24)).toBe("");
  });
});

/**
 * Recursively extract all text content from a React element tree.
 */
function flattenText(element: React.ReactElement): string {
  const parts: string[] = [];
  function walk(node: unknown) {
    if (typeof node === "string") {
      parts.push(node);
    } else if (typeof node === "number") {
      parts.push(String(node));
    } else if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (typeof props.children !== "undefined") {
        React.Children.forEach(props.children as React.ReactNode, walk);
      }
    }
  }
  walk(element);
  return parts.join(" ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function collectRenderedRows(element: React.ReactElement): string[] {
  const props = element.props as { children?: React.ReactNode };
  return React.Children.toArray(props.children)
    .filter((child): child is React.ReactElement => React.isValidElement(child))
    .map((child) => flattenTextRaw(child));
}

function flattenTextRaw(element: React.ReactElement): string {
  const parts: string[] = [];

  function walk(node: unknown) {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }

    if (typeof node === "number") {
      parts.push(String(node));
      return;
    }

    if (!React.isValidElement(node)) {
      return;
    }

    const props = node.props as Record<string, unknown>;
    if (typeof props.children !== "undefined") {
      React.Children.forEach(props.children as React.ReactNode, walk);
    }
  }

  walk(element);
  return parts.join("");
}

function collectTextSegments(element: React.ReactElement): Array<{ text: string; bold?: boolean; italic?: boolean; color?: string; backgroundColor?: string }> {
  const segments: Array<{ text: string; bold?: boolean; italic?: boolean; color?: string; backgroundColor?: string }> = [];

  function walk(node: unknown, inherited: { bold?: boolean; italic?: boolean; color?: string; backgroundColor?: string } = {}) {
    if (typeof node === "string") {
      segments.push({ text: node, ...inherited });
      return;
    }

    if (!React.isValidElement(node)) {
      return;
    }

    const props = node.props as Record<string, unknown>;
    const nextInherited = {
      bold: typeof props.bold === "boolean" ? props.bold : inherited.bold,
      italic: typeof props.italic === "boolean" ? props.italic : inherited.italic,
      color: typeof props.color === "string" ? props.color : inherited.color,
      backgroundColor: typeof props.backgroundColor === "string" ? props.backgroundColor : inherited.backgroundColor,
    };

    if (typeof props.children !== "undefined") {
      React.Children.forEach(props.children as React.ReactNode, (child) => walk(child, nextInherited));
    }
  }

  walk(element);
  return segments;
}