import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_BUILD_INFO,
  getBuildInfoCandidates,
  loadBuildInfoFromCandidates,
} from "../src/build/buildInfo";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pebble-build-info-"));
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

describe("Build info resolution", () => {
  test("prefers metadata next to the bundled file", () => {
    const baseDir = createTempDir();
    const cwd = createTempDir();
    const expected = {
      version: "1.2.3",
      buildDate: "2026-04-03",
      commit: "abc1234",
      variant: "stable",
    };

    writeFileSync(join(baseDir, "build-meta.json"), JSON.stringify(expected), "utf-8");
    mkdirSync(join(cwd, "dist"), { recursive: true });
    writeFileSync(
      join(cwd, "dist", "build-meta.json"),
      JSON.stringify({ ...expected, version: "9.9.9" }),
      "utf-8",
    );

    const loaded = loadBuildInfoFromCandidates(getBuildInfoCandidates(baseDir, cwd));
    expect(loaded).toEqual(expected);
  });

  test("falls back to cwd/dist metadata when source-relative metadata is absent", () => {
    const baseDir = join(createTempDir(), "src", "build");
    const cwd = createTempDir();
    const expected = {
      version: "2.0.0",
      buildDate: "2026-04-03",
      commit: "def5678",
      variant: "beta",
    };

    mkdirSync(baseDir, { recursive: true });
    mkdirSync(join(cwd, "dist"), { recursive: true });
    writeFileSync(join(cwd, "dist", "build-meta.json"), JSON.stringify(expected), "utf-8");

    const loaded = loadBuildInfoFromCandidates(getBuildInfoCandidates(baseDir, cwd));
    expect(loaded).toEqual(expected);
  });

  test("returns development defaults when metadata is missing or invalid", () => {
    const baseDir = createTempDir();
    const cwd = createTempDir();

    writeFileSync(join(baseDir, "build-meta.json"), "{invalid-json", "utf-8");

    const loaded = loadBuildInfoFromCandidates(getBuildInfoCandidates(baseDir, cwd));
    expect(loaded).toEqual(DEFAULT_BUILD_INFO);
  });
});