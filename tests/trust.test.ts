import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assessTrust, findProjectRoot, isPathTrusted } from "../src/runtime/trust";
import { PermissionManager } from "../src/runtime/permissionManager";

const tempDirs: string[] = [];

function createTempProject(prefix: string, options: { trustMarker?: "trusted" | "bare" } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: prefix }, null, 2), "utf-8");

  if (options.trustMarker) {
    writeFileSync(join(dir, ".pebble-trust"), options.trustMarker, "utf-8");
  }

  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Trust System", () => {
  test("finds project root from nested directory", () => {
    const root = createTempProject("pebble-trust-root-");
    const nested = join(root, "src", "features", "nested");
    mkdirSync(nested, { recursive: true });

    expect(findProjectRoot(nested)).toBe(root);
  });

  test("assesses trust level from project markers and explicit trust markers", () => {
    const trustedRoot = createTempProject("pebble-trust-trusted-");
    const bareRoot = createTempProject("pebble-trust-bare-", { trustMarker: "bare" });
    const untrustedDir = mkdtempSync(join(tmpdir(), "pebble-trust-untrusted-"));
    tempDirs.push(untrustedDir);

    expect(assessTrust(trustedRoot)).toBe("trusted");
    expect(assessTrust(bareRoot)).toBe("bare");
    expect(assessTrust(untrustedDir)).toBe("untrusted");
  });

  test("checks path trust", () => {
    const root = createTempProject("pebble-trust-path-");
    const trustedFile = join(root, "src", "index.ts");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(trustedFile, "export {};\n", "utf-8");

    expect(isPathTrusted(trustedFile, root)).toBe(true);
    expect(isPathTrusted(join(tmpdir(), "suspicious"), root)).toBe(false);
  });
});

describe("Permission Manager", () => {
  test("auto-approves low risk tools", async () => {
    const projectRoot = createTempProject("pebble-permissions-low-risk-");
    const manager = new PermissionManager({
      mode: "always-ask",
      projectRoot,
    });

    const result = await manager.checkPermission({
      toolName: "Glob",
      toolArgs: { pattern: "*.ts" },
      riskLevel: "low",
    });

    expect(result.decision).toBe("allow");
  });

  test("respects auto-all mode", async () => {
    const projectRoot = createTempProject("pebble-permissions-auto-all-");
    const manager = new PermissionManager({
      mode: "auto-all",
      projectRoot,
    });

    const result = await manager.checkPermission({
      toolName: "Bash",
      toolArgs: { command: "ls" },
      riskLevel: "high",
    });

    expect(result.decision).toBe("allow");
  });

  test("respects restricted mode", async () => {
    const projectRoot = createTempProject("pebble-permissions-restricted-");
    const manager = new PermissionManager({
      mode: "restricted",
      projectRoot,
    });

    const result = await manager.checkPermission({
      toolName: "Bash",
      toolArgs: { command: "ls" },
      riskLevel: "high",
    });

    expect(result.decision).toBe("deny");
  });

  test("records and persists decisions", async () => {
    const projectRoot = createTempProject("pebble-permissions-persist-");
    const manager = new PermissionManager({
      mode: "always-ask",
      projectRoot,
    });

    manager.recordDecision("Bash", "allow-session", false);
    manager.recordDecision("FileEdit", "allow-always", true);

    const decisions = manager.getDecisions();
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  test("clears session allows", () => {
    const projectRoot = createTempProject("pebble-permissions-clear-");
    const manager = new PermissionManager({
      mode: "always-ask",
      projectRoot,
    });

    manager.recordDecision("Bash", "allow-session", false);
    manager.clearSessionAllows();
  });
});
