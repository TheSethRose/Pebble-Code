import React from "react";
import { describe, expect, test } from "bun:test";
import { TranscriptView } from "../src/ui/components/TranscriptView";
import type { DisplayMessage } from "../src/ui/types";

function createMessage(role: DisplayMessage["role"], content = "test"): DisplayMessage {
  return { role, content };
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
});