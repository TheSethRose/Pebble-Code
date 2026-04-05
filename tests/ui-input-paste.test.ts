import { describe, expect, test } from "bun:test";
import {
  expandPastedTextReferences,
  formatPastedTextRef,
  getPastedTextRefNumLines,
  normalizePastedText,
  parsePastedTextReferences,
  shouldStagePastedText,
  type PastedTextContent,
} from "../src/ui/components/inputPaste";

describe("inputPaste helpers", () => {
  test("normalizes pasted text for terminal display and submission", () => {
    expect(normalizePastedText("\u001B[31mred\u001B[0m\r\n\tindent")).toBe("red\n    indent");
  });

  test("counts pasted newline breaks in placeholder summaries", () => {
    expect(getPastedTextRefNumLines("single line")).toBe(0);
    expect(getPastedTextRefNumLines("line 1\nline 2\nline 3")).toBe(2);
    expect(formatPastedTextRef(1, 0)).toBe("[Pasted text #1]");
    expect(formatPastedTextRef(2, 3)).toBe("[Pasted text #2 +3 lines]");
  });

  test("stages multiline and long single-line pastes", () => {
    expect(shouldStagePastedText("short inline paste")).toBe(false);
    expect(shouldStagePastedText("line 1\nline 2")).toBe(true);
    expect(shouldStagePastedText("x".repeat(160))).toBe(true);
  });

  test("parses and expands pasted text references on submit", () => {
    const pastedContents: Record<number, PastedTextContent> = {
      1: { id: 1, type: "text", content: "const answer = 42;" },
      2: { id: 2, type: "text", content: "line 1\nline 2" },
    };

    expect(parsePastedTextReferences("Review [Pasted text #1] and [Pasted text #2 +1 lines]")).toEqual([
      { id: 1, match: "[Pasted text #1]", index: 7 },
      { id: 2, match: "[Pasted text #2 +1 lines]", index: 28 },
    ]);
    expect(expandPastedTextReferences(
      "Review [Pasted text #1] and [Pasted text #2 +1 lines]",
      pastedContents,
    )).toBe("Review const answer = 42; and line 1\nline 2");
  });
});
