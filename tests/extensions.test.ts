import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommandRegistry } from "../src/commands/registry";
import type { Command } from "../src/commands/types";
import { loadExtensions } from "../src/extensions/loaders";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
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

describe("Extension loading", () => {
  test("loads extension commands from a plugin module", async () => {
    const dir = createTempDir("pebble-extension-");
    writeFileSync(
      join(dir, "hello.ts"),
      `
export default {
  metadata: {
    id: "hello-plugin",
    name: "Hello Plugin",
    version: "1.0.0"
  },
  commands: [
    {
      name: "hello-ext",
      description: "hello from extension",
      type: "local",
      execute() {
        return { success: true, output: "hello from extension" };
      }
    }
  ]
};
      `.trim(),
      "utf-8",
    );

    const results = await loadExtensions([dir]);
    expect(results).toHaveLength(1);
    expect(results[0]?.loaded).toBe(true);
    expect(results[0]?.extension?.commands?.[0]?.name).toBe("hello-ext");
  });

  test("isolates broken extension modules", async () => {
    const dir = createTempDir("pebble-extension-broken-");
    writeFileSync(join(dir, "broken.ts"), `export default { nope: true };`, "utf-8");

    const results = await loadExtensions([dir]);
    expect(results).toHaveLength(1);
    expect(results[0]?.loaded).toBe(false);
    expect(results[0]?.error).toContain("valid extension");
  });
});

describe("Command registry extension merging", () => {
  test("registerMany merges extension commands into the live registry", async () => {
    const registry = new CommandRegistry();
    const extensionCommand: Command = {
      name: "hello-ext",
      description: "hello from extension",
      type: "local",
      execute: () => ({ success: true, output: "hello from extension" }),
    };

    registry.registerMany([extensionCommand]);

    expect(registry.find("hello-ext")).toBeDefined();
    const result = await registry.execute("hello-ext", "", {
      cwd: process.cwd(),
      headless: false,
      config: {},
      trustLevel: "trusted",
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("hello from extension");
  });
});