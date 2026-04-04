import { describe, expect, test } from "bun:test";
import {
  formatProgressStatus,
  formatToolStatus,
  resolveMaxTurns,
  summarizeToolArgs,
} from "../src/ui/toolStatus";

describe("toolStatus helpers", () => {
  test("formats descriptive WorkspaceRead status text with prioritized args", () => {
    const status = formatToolStatus("WorkspaceRead", {
      action: "project_structure",
      path: ".",
      max_depth: 2,
      include_hidden: false,
    });

    expect(status).toContain("Inspecting workspace");
    expect(status).toContain("action: project_structure");
    expect(status).toContain("path: .");
    expect(status.indexOf("action:")).toBeLessThan(status.indexOf("include_hidden:"));
  });

  test("formats analyzing status after a successful tool result", () => {
    const status = formatToolStatus("WorkspaceRead", { action: "git_inspect", mode: "status" }, "analyzing");

    expect(status).toContain("Analyzing WorkspaceRead result");
    expect(status).toContain("action: git_inspect");
  });

  test("keeps detailed status during progress updates instead of overwriting it", () => {
    expect(formatProgressStatus("Inspecting workspace · action: project_structure", { turn: 2, maxTurns: 20 }))
      .toBe("Inspecting workspace · action: project_structure");
  });

  test("falls back to turn-aware working text when no detailed status exists", () => {
    expect(formatProgressStatus("", { turn: 3, maxTurns: 12 })).toBe("Working… (turn 3/12)");
  });

  test("resolves maxTurns from numeric strings and invalid values", () => {
    expect(resolveMaxTurns("12")).toBe(12);
    expect(resolveMaxTurns(7)).toBe(7);
    expect(resolveMaxTurns("bogus", 50)).toBe(50);
  });

  test("summarizes tool args with truncation", () => {
    const summary = summarizeToolArgs({
      action: "grep",
      pattern: "very-long-pattern-very-long-pattern-very-long-pattern",
      path: "src",
    }, 40);

    expect(summary).toContain("action: grep");
    expect(summary.endsWith("…")).toBe(true);
  });
});
