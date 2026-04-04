import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("SDK entrypoint surface", () => {
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