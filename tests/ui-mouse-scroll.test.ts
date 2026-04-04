import { describe, expect, test } from "bun:test";
import { isPointWithinRect } from "../src/ui/components/MouseScrollableRegion";
import { extractMouseInput, splitMouseInputSegments } from "../src/ui/components/TerminalMouseProvider";

describe("MouseScrollableRegion helpers", () => {
  test("detects points inside a rectangular transcript region", () => {
    expect(isPointWithinRect({ x: 12, y: 8 }, { left: 10, top: 5, width: 8, height: 4 })).toBe(true);
  });

  test("rejects points outside or on the exclusive bottom/right edge", () => {
    const rect = { left: 10, top: 5, width: 8, height: 4 };

    expect(isPointWithinRect({ x: 18, y: 8 }, rect)).toBe(false);
    expect(isPointWithinRect({ x: 9, y: 8 }, rect)).toBe(false);
    expect(isPointWithinRect({ x: 12, y: 9 }, rect)).toBe(false);
  });

  test("rejects empty rectangles", () => {
    expect(isPointWithinRect({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 5 })).toBe(false);
    expect(isPointWithinRect({ x: 1, y: 1 }, { left: 0, top: 0, width: 5, height: 0 })).toBe(false);
  });
});

describe("TerminalMouseProvider helpers", () => {
  test("splits mouse escape sequences away from regular input", () => {
    const segments = splitMouseInputSegments("hello\u001B[<64;58;23Mworld");

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: "text", value: "hello" });
    expect(segments[1]).toMatchObject({
      type: "mouse",
      value: "\u001B[<64;58;23M",
      event: { type: "scroll", direction: "up", x: 57, y: 22 },
    });
    expect(segments[2]).toMatchObject({ type: "text", value: "world" });
  });

  test("parses move events so they can be swallowed instead of entering the prompt", () => {
    const segments = splitMouseInputSegments("\u001B[<35;62;35M");

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: "mouse",
      event: { type: "move", x: 61, y: 34 },
    });
  });

  test("normalizes sgr mouse coordinates to zero-based layout space", () => {
    const segments = splitMouseInputSegments("\u001B[<0;1;1M");

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: "mouse",
      event: { type: "press", x: 0, y: 0 },
    });
  });

  test("leaves plain text untouched when no mouse escapes are present", () => {
    expect(splitMouseInputSegments("/help")).toEqual([{ type: "text", value: "/help" }]);
  });

  test("carries incomplete mouse sequences across chunk boundaries", () => {
    const first = extractMouseInput("hello\u001B[<64;58;");
    const second = extractMouseInput("23Mworld", first.pending);

    expect(first.segments).toEqual([{ type: "text", value: "hello" }]);
    expect(first.pending).toBe("\u001B[<64;58;");
    expect(second.pending).toBe("");
    expect(second.segments).toHaveLength(2);
    expect(second.segments[0]).toMatchObject({
      type: "mouse",
      value: "\u001B[<64;58;23M",
      event: { type: "scroll", direction: "up", x: 57, y: 22 },
    });
    expect(second.segments[1]).toEqual({ type: "text", value: "world" });
  });
});