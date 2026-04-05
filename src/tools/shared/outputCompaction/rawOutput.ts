import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export function persistRawToolOutput(params: {
  cwd: string;
  category: "shell" | "grep" | "read";
  identifier: string;
  rawOutput: string;
}): string | undefined {
  if (!params.rawOutput.trim()) {
    return undefined;
  }

  const dir = join(params.cwd, ".pebble", "tool-outputs");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const safeIdentifier = params.identifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "output";
  const hash = buildStableOutputHash(`${params.category}:${safeIdentifier}:${params.rawOutput}`);
  const filePath = join(dir, `${params.category}-${safeIdentifier}-${Date.now()}-${hash}.log`);
  writeFileSync(filePath, params.rawOutput, "utf-8");
  return filePath;
}

export function buildCompactOutputIdentifier(input: string): string {
  const trimmed = input.trim();
  return basename(trimmed).replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 48) || "output";
}

function buildStableOutputHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36).padStart(7, "0").slice(0, 7);
}