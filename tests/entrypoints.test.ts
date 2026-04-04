import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getVersionString } from "../src/build/buildInfo";

function runCli(args: string[]) {
  const repoRoot = join(import.meta.dir, "..");
  const result = Bun.spawnSync(
    [process.execPath, "run", "src/entrypoints/cli.tsx", ...args],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        OPENROUTER_API_KEY: "",
        PEBBLE_API_KEY: "",
      },
    },
  );

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

describe("SDK entrypoint surface", () => {
  test("CLI fast path prints version without booting the runtime", () => {
    const result = runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(getVersionString());
    expect(result.stderr).toBe("");
  });

  test("CLI fast path prints help text and runtime flags", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("FAST COMMANDS (no runtime boot)");
    expect(result.stdout).toContain("--headless, -p");
    expect(result.stdout).toContain("/login");
  });

  test("root package entrypoint exports the programmatic runtime helpers", async () => {
    const entrypoint = await import("../index");

    expect(typeof entrypoint.runSdk).toBe("function");
    expect(typeof entrypoint.runHeadless).toBe("function");
    expect(typeof entrypoint.query).toBe("function");
    expect(typeof entrypoint.streamQuery).toBe("function");
    expect(typeof entrypoint.parseSdkEvent).toBe("function");
    expect(typeof entrypoint.serializeSdkEvent).toBe("function");
    expect(typeof entrypoint.QueryEngine).toBe("function");
  });

  test("package metadata points imports at the SDK entrypoint instead of the CLI", () => {
    const packageJson = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"),
    ) as {
      module?: string;
      exports?: Record<string, string>;
    };

    expect(packageJson.module).toBe("./index.ts");
    expect(packageJson.exports?.["."]).toBe("./index.ts");
    expect(packageJson.exports?.["./cli"]).toBe("./src/entrypoints/cli.tsx");
  });
});