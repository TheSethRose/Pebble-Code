import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  isSecretLikeValue,
  parseSecretScanMode,
  runStandaloneCheck,
  scanForMode,
} from "../scripts/check-no-staged-provider-secrets";

function createTempRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function runGit(repoDir: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = decode(result.stderr);
    throw new Error(stderr || `git ${args.join(" ")} failed with exit code ${result.exitCode}`);
  }

  return decode(result.stdout);
}

function writeAndStage(repoDir: string, relativePath: string, contents: string): void {
  const absolutePath = join(repoDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
  runGit(repoDir, ["add", relativePath]);
}

function buildFakeSecret(suffix: string): string {
  return ["sk", "or", "v1", `fixture-${suffix}-abc123xyz987654`].join("-");
}

const tempPaths: string[] = [];

afterEach(() => {
  while (tempPaths.length > 0) {
    const nextPath = tempPaths.pop();
    if (nextPath) {
      rmSync(nextPath, { recursive: true, force: true });
    }
  }
});

describe("git hook secret scanner", () => {
  test("parses explicit secret scan modes", () => {
    expect(parseSecretScanMode([])).toBe("staged");
    expect(parseSecretScanMode(["--mode", "push"])).toBe("push");
    expect(parseSecretScanMode(["--mode=staged"])).toBe("staged");
  });

  test("ignores short sk-or-v1 fixtures but catches realistically long ones", () => {
    expect(isSecretLikeValue("sk-or-v1-test-key")).toBe(false);
    expect(isSecretLikeValue("sk-or-v1-stale-openrouter-token")).toBe(false);
    expect(isSecretLikeValue("sk-or-v1-fixture_demo_token")).toBe(false);
    expect(isSecretLikeValue(buildFakeSecret("long-token"))).toBe(true);
  });

  test("detects staged sk-or-v1 additions", () => {
    const repoDir = createTempRepo("pebble-secret-hook-staged-");
    tempPaths.push(repoDir);

    runGit(repoDir, ["init", "-q"]);
    runGit(repoDir, ["config", "user.email", "test@example.com"]);
    runGit(repoDir, ["config", "user.name", "Pebble Test"]);

    writeAndStage(repoDir, "secret.txt", `token=${buildFakeSecret("demo-secret")}\n`);

    const violations = scanForMode(repoDir, "staged");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe("secret.txt");
    expect(violations[0]?.redactedLine).toContain("sk-or-v1-•••");
    expect(runStandaloneCheck(repoDir, "staged")).toBe(2);
  });

  test("ignores bare sk-or-v1 prefix literals without a token suffix", () => {
    const repoDir = createTempRepo("pebble-secret-hook-prefix-only-");
    tempPaths.push(repoDir);

    runGit(repoDir, ["init", "-q"]);
    runGit(repoDir, ["config", "user.email", "test@example.com"]);
    runGit(repoDir, ["config", "user.name", "Pebble Test"]);

    writeAndStage(repoDir, "scripts/check-no-staged-provider-secrets.ts", 'const SECRET_PREFIX = "sk-or-v1-";\n');

    expect(scanForMode(repoDir, "staged")).toEqual([]);
    expect(runStandaloneCheck(repoDir, "staged")).toBe(0);
  });

  test("detects outgoing push secrets against the tracked upstream", () => {
    const remoteDir = createTempRepo("pebble-secret-hook-remote-");
    const repoDir = createTempRepo("pebble-secret-hook-push-");
    tempPaths.push(remoteDir, repoDir);

    runGit(remoteDir, ["init", "--bare", "-q"]);
    runGit(repoDir, ["init", "-q"]);
    runGit(repoDir, ["config", "user.email", "test@example.com"]);
    runGit(repoDir, ["config", "user.name", "Pebble Test"]);
    runGit(repoDir, ["branch", "-M", "main"]);

    writeAndStage(repoDir, "README.md", "clean\n");
    runGit(repoDir, ["commit", "-m", "initial", "-q"]);
    runGit(repoDir, ["remote", "add", "origin", remoteDir]);
    runGit(repoDir, ["push", "-u", "origin", "main", "-q"]);

    writeAndStage(repoDir, "secret.txt", `token=${buildFakeSecret("push-secret")}\n`);
    runGit(repoDir, ["commit", "-m", "secret", "-q"]);

    const violations = scanForMode(repoDir, "push");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe("secret.txt");
    expect(runStandaloneCheck(repoDir, "push")).toBe(2);
  });
});