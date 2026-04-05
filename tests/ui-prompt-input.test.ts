import React from "react";
import { describe, expect, test } from "bun:test";
import { PromptInput } from "../src/ui/components/PromptInput";

describe("PromptInput", () => {
  test("does not duplicate the idle prompt copy above the input row", () => {
    const flat = normalizeWhitespace(flattenText(
      PromptInput({
        isProcessing: false,
        onSubmit: () => {},
        width: 40,
      }),
    ));

    expect(flat).not.toContain("Ask Pebble anything…");
    expect(flat).toMatch(/Ready\s+·\s+Enter sends\s+·\s+Tab ⇄ sessions/);
    expect(flat.match(/─{10,}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test("shows a single clean working status when processing", () => {
    const flat = normalizeWhitespace(flattenText(
      PromptInput({
        isProcessing: true,
        onSubmit: () => {},
        width: 40,
      }),
    ));

    expect(flat).toContain("Working…");
    expect(flat).not.toContain("Pebble is working…");
    expect(flat).not.toContain("Thinking…");
    expect(flat).not.toContain("Streaming results below");
  });

  test("renders a custom in-flight status label when one is provided", () => {
    const flat = normalizeWhitespace(flattenText(
      PromptInput({
        isProcessing: true,
        statusText: "Inspecting workspace · action: project_structure, path: .",
        onSubmit: () => {},
        width: 80,
      }),
    ));

    expect(flat).toContain("Inspecting workspace · action: project_structure, path: .");
    expect(flat).not.toContain("Pebble is working…");
  });

  test("shows the hold-to-talk hint when voice mode is enabled", () => {
    const flat = normalizeWhitespace(flattenText(
      PromptInput({
        isProcessing: false,
        onSubmit: () => {},
        width: 60,
        voiceEnabled: true,
      }),
    ));

    expect(flat).toContain("Hold Space to talk");
  });

  test("shows recording state copy when voice capture is active", () => {
    const flat = normalizeWhitespace(flattenText(
      PromptInput({
        isProcessing: false,
        onSubmit: () => {},
        width: 60,
        voiceEnabled: true,
        voiceState: "recording",
        voiceAudioLevels: [0, 0.2, 0.5, 1],
      }),
    ));

    expect(flat).toContain("Recording…");
    expect(flat).toContain("Release Space to transcribe");
  });

  test("renders slash command aliases in the popup", () => {
    const flat = normalizeWhitespace(flattenText(
      PromptInput({
        isProcessing: false,
        onSubmit: () => {},
        width: 80,
        suggestions: [{
          name: "clear",
          aliases: ["cls", "new"],
          description: "Clear the conversation",
          insertText: "new",
        }],
      }),
    ));

    expect(flat).toContain("/clear");
    expect(flat).toContain("/new");
    expect(flat).toContain("Clear the conversation");
  });

  test("shows staged paste status when pasted content is queued", () => {
    const flat = normalizeWhitespace(flattenText(
      PromptInput({
        isProcessing: false,
        onSubmit: () => {},
        width: 80,
        stagedPasteCount: 2,
      }),
    ));

    expect(flat).toContain("2 pasted blocks staged");
    expect(flat).toContain("Enter sends the full pasted content");
  });

});

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

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
