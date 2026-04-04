import { test, expect, describe } from "bun:test";
import { assessTrust, findProjectRoot, isPathTrusted } from "../src/runtime/trust";
import { PermissionManager } from "../src/runtime/permissionManager";

describe("Trust System", () => {
  test("finds project root from nested directory", () => {
    const root = findProjectRoot(process.cwd());
    expect(root).not.toBeNull();
    expect(root).toContain("Pebble-Code");
  });

  test("assesses trust level for current directory", () => {
    const level = assessTrust(process.cwd());
    expect(["trusted", "untrusted", "bare"]).toContain(level);
  });

  test("checks path trust", () => {
    const root = findProjectRoot(process.cwd()) ?? process.cwd();
    expect(isPathTrusted(process.cwd(), root)).toBe(true);
    expect(isPathTrusted("/tmp/suspicious", root)).toBe(false);
  });
});

describe("Permission Manager", () => {
  test("auto-approves low risk tools", async () => {
    const manager = new PermissionManager({
      mode: "always-ask",
      projectRoot: process.cwd(),
    });

    const result = await manager.checkPermission({
      toolName: "Glob",
      toolArgs: { pattern: "*.ts" },
      riskLevel: "low",
    });

    expect(result.decision).toBe("allow");
  });

  test("respects auto-all mode", async () => {
    const manager = new PermissionManager({
      mode: "auto-all",
      projectRoot: process.cwd(),
    });

    const result = await manager.checkPermission({
      toolName: "Bash",
      toolArgs: { command: "ls" },
      riskLevel: "high",
    });

    expect(result.decision).toBe("allow");
  });

  test("respects restricted mode", async () => {
    const manager = new PermissionManager({
      mode: "restricted",
      projectRoot: process.cwd(),
    });

    const result = await manager.checkPermission({
      toolName: "Bash",
      toolArgs: { command: "ls" },
      riskLevel: "high",
    });

    expect(result.decision).toBe("deny");
  });

  test("records and persists decisions", async () => {
    const manager = new PermissionManager({
      mode: "always-ask",
      projectRoot: process.cwd(),
    });

    manager.recordDecision("Bash", "allow-session", false);
    manager.recordDecision("FileEdit", "allow-always", true);

    const decisions = manager.getDecisions();
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  test("clears session allows", () => {
    const manager = new PermissionManager({
      mode: "always-ask",
      projectRoot: process.cwd(),
    });

    manager.recordDecision("Bash", "allow-session", false);
    manager.clearSessionAllows();
  });
});
