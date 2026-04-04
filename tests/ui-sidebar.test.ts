import { describe, expect, test } from "bun:test";
import {
  buildSidebarRow,
  buildVerticalDivider,
  deriveSessionTitle,
  getScrollingSessionLabel,
  getSidebarHintText,
  shouldAnimateSessionLabel,
  truncateSessionLabel,
  wrapSessionLabel,
} from "../src/ui/components/SessionSidebar";

describe("SessionSidebar helpers", () => {
  test("wraps long session labels on word boundaries for narrow sidebars", () => {
    const wrapped = wrapSessionLabel("What tools do you have available?", 26);

    expect(wrapped).toEqual([
      "What tools do you have",
      "available?",
    ]);
    expect(wrapped.join(" ")).toBe("What tools do you have available?");
    expect(wrapSessionLabel("Short title", 26)).toEqual(["Short title"]);
  });

  test("derives a session title from the first user message", () => {
    expect(deriveSessionTitle([{ role: "assistant", content: "hi" }, { role: "user", content: " First line\nSecond line" }])).toBe("First line");
  });

  test("builds a straight vertical divider", () => {
    expect(buildVerticalDivider(3)).toBe("│\n│\n│");
  });

  test("keeps sidebar rows single-line and padded to a consistent width", () => {
    expect(truncateSessionLabel("What tools do you have available?", 26)).toBe("What tools do you h...");
    const row = buildSidebarRow("Short title", 26, "▸ ");
    expect(row.startsWith("▸ Short title")).toBe(true);
    expect(row).toHaveLength(24);
  });

  test("uses literal dot truncation for very narrow sidebars", () => {
    expect(truncateSessionLabel("abcdefghij", 10)).toBe("abcde...");
  });

  test("creates a scrolling frame for selected long labels", () => {
    expect(shouldAnimateSessionLabel("What tools do you have available?", 26)).toBe(true);
    expect(getScrollingSessionLabel("What tools do you have available?", 26, 0)).toBe("What tools do you have");
    expect(getScrollingSessionLabel("What tools do you have available?", 26, 5)).toBe("tools do you have avai");
    expect(shouldAnimateSessionLabel("Short title", 26)).toBe(false);
  });

  test("shows the correct sidebar hint for focused vs unfocused states", () => {
    expect(getSidebarHintText(true)).toBe("↑↓ move  ⏎ select\nDel to Delete Chats");
    expect(getSidebarHintText(false)).toBe("→ Tab to Select Chats");
  });
});