import { describe, expect, test } from "bun:test";
import { isPointWithinRect } from "../src/ui/components/MouseScrollableRegion";

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