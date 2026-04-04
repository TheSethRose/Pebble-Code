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

  test("still shows the working status row when processing", () => {
    const flat = normalizeWhitespace(flattenText(
      PromptInput({
        isProcessing: true,
        onSubmit: () => {},
        width: 40,
      }),
    ));

    expect(flat).toContain("Pebble is working…");
    expect(flat).toContain("Streaming results below");
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
