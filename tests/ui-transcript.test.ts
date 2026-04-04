import React from "react";
import { describe, expect, test } from "bun:test";
import { TranscriptView } from "../src/ui/components/TranscriptView";
import { MessageItem } from "../src/ui/components/MessageItem";
import type { DisplayMessage } from "../src/ui/types";

function createMessage(role: DisplayMessage["role"], content = "test", meta?: DisplayMessage["meta"]): DisplayMessage {
  return { role, content, meta };
}

describe("TranscriptView", () => {
  test("does not render a separate inline processing status row", () => {
    const element = TranscriptView({
      messages: [createMessage("tool", "Bash")],
    });

    const children = React.Children.toArray(element.props.children);

    expect(children).toHaveLength(1);
  });

  test("shows an overflow notice alongside the visible message window", () => {
    const messages = Array.from({ length: 25 }, (_, index) =>
      createMessage(index % 2 === 0 ? "assistant" : "user", `message ${index + 1}`),
    );

    const element = TranscriptView({ messages });
    const children = React.Children.toArray(element.props.children);

    expect(children).toHaveLength(21);
  });

  test("groups tool_call + tool_result into a single tool group", () => {
    const messages = [
      createMessage("user", "run ls"),
      createMessage("tool", "Bash", { toolName: "Bash" }),
      createMessage("tool_result", "Bash done", { toolName: "Bash" }),
      createMessage("assistant", "Here are the files."),
    ];

    const element = TranscriptView({ messages });
    const children = React.Children.toArray(element.props.children);

    // user + tool-group + assistant = 3 elements
    expect(children).toHaveLength(3);
  });

  test("collapses consecutive progress messages to the latest one", () => {
    const messages = [
      createMessage("progress", "Turn 1/50", { turnNumber: 1 }),
      createMessage("progress", "Turn 2/50", { turnNumber: 2 }),
      createMessage("progress", "Turn 3/50", { turnNumber: 3 }),
      createMessage("assistant", "Done"),
    ];

    const element = TranscriptView({ messages });
    const children = React.Children.toArray(element.props.children);

    // collapsed progress + assistant = 2 elements
    expect(children).toHaveLength(2);
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
      message: createMessage("tool_result", "Bash done", { toolName: "Bash" }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("✓");
    expect(flat).toContain("Bash done");
  });

  test("renders error tool result with failure marker", () => {
    const element = MessageItem({
      message: createMessage("tool_result", "Bash failed", { toolName: "Bash", isError: true }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("✗");
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