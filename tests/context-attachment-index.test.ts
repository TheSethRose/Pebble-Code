import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContextAttachmentIndex } from "../src/ui/contextAttachmentIndex";

const tempDirs: string[] = [];

function createTempProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: prefix }, null, 2), "utf-8");
  return dir;
}

function writeProjectFile(projectDir: string, relativePath: string, content = "sample\n"): void {
  const absolutePath = join(projectDir, relativePath);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content, "utf-8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("context attachment index", () => {
  test("includes gitignored workspace files while still skipping .git and node_modules", () => {
    const projectDir = createTempProject("pebble-context-index-");

    writeProjectFile(projectDir, "dist-debug/pebble.js");
    writeProjectFile(projectDir, "coverage/lcov.info");
    writeProjectFile(projectDir, "private/context/snapshot.md");
    writeProjectFile(projectDir, ".pebble/project-settings.json", "{}\n");
    writeProjectFile(projectDir, ".git/config", "[core]\n");
    writeProjectFile(projectDir, "node_modules/example/index.js");

    const index = createContextAttachmentIndex(projectDir);
    const paths = index.entries.map((entry) => entry.path);

    expect(paths).toContain("dist-debug/pebble.js");
    expect(paths).toContain("coverage/lcov.info");
    expect(paths).toContain("private/context/snapshot.md");
    expect(paths).toContain(".pebble/project-settings.json");
    expect(paths).not.toContain(".git/config");
    expect(paths).not.toContain("node_modules/example/index.js");
  });
});