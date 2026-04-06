import { describe, expect, test } from "bun:test";
import {
  getConfigTabDisplayRows,
  getInitialConfigTabActiveIndex,
  moveConfigTabActiveIndex,
} from "../src/ui/Settings";

describe("settings config navigation helpers", () => {
  test("marks exactly one active row even when multiple settings are selected", () => {
    const activeIndex = getInitialConfigTabActiveIndex({
      shellCompactionMode: "auto",
      worktreeStartupMode: "manual",
    });

    const rows = getConfigTabDisplayRows({
      shellCompactionMode: "auto",
      worktreeStartupMode: "manual",
    }, activeIndex);

    expect(rows.filter((row) => row.isSelected)).toHaveLength(2);
    expect(rows.filter((row) => row.isActive)).toHaveLength(1);
    expect(rows[activeIndex]).toMatchObject({
      groupId: "shell-compaction",
      optionValue: "auto",
      isActive: true,
      isSelected: true,
    });
  });

  test("moves the config cursor through both groups without activating two rows", () => {
    let activeIndex = getInitialConfigTabActiveIndex({
      shellCompactionMode: "auto",
      worktreeStartupMode: "manual",
    });

    activeIndex = moveConfigTabActiveIndex(activeIndex, "down", 5);
    activeIndex = moveConfigTabActiveIndex(activeIndex, "down", 5);

    const rows = getConfigTabDisplayRows({
      shellCompactionMode: "auto",
      worktreeStartupMode: "manual",
    }, activeIndex);

    expect(rows.filter((row) => row.isActive)).toHaveLength(1);
    expect(rows[activeIndex]).toMatchObject({
      groupId: "worktree-startup",
      optionValue: "manual",
      isActive: true,
      isSelected: true,
    });
  });

  test("wraps the config cursor from the first row to the last row", () => {
    const wrappedIndex = moveConfigTabActiveIndex(0, "up", 5);
    const rows = getConfigTabDisplayRows({
      shellCompactionMode: "auto",
      worktreeStartupMode: "manual",
    }, wrappedIndex);

    expect(wrappedIndex).toBe(4);
    expect(rows.filter((row) => row.isActive)).toHaveLength(1);
    expect(rows[wrappedIndex]).toMatchObject({
      groupId: "worktree-startup",
      optionValue: "resume-linked",
      isActive: true,
      isSelected: false,
    });
  });
});