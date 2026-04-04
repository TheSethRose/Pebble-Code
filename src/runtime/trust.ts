import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TrustConfig, TrustLevel } from "./permissions";

/**
 * Determine trust level for a directory.
 */
export function assessTrust(cwd: string): TrustLevel {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    return "untrusted";
  }

  // Check for .pebble-trust marker file
  const trustFile = join(projectRoot, ".pebble-trust");
  if (existsSync(trustFile)) {
    try {
      const content = readFileSync(trustFile, "utf-8").trim();
      if (content === "trusted") return "trusted";
      if (content === "bare") return "bare";
    } catch {
      // ignore
    }
  }

  // Default: trusted if it has recognizable project markers
  const hasProjectMarker =
    existsSync(join(projectRoot, "package.json")) ||
    existsSync(join(projectRoot, "tsconfig.json")) ||
    existsSync(join(projectRoot, "pyproject.toml")) ||
    existsSync(join(projectRoot, "Cargo.toml")) ||
    existsSync(join(projectRoot, "go.mod")) ||
    existsSync(join(projectRoot, ".git"));

  return hasProjectMarker ? "trusted" : "untrusted";
}

/**
 * Find the project root by walking up the directory tree.
 */
export function findProjectRoot(from: string): string | null {
  let current = resolve(from);
  const root = process.platform === "win32" ? current.slice(0, 3) : "/";

  while (current !== root) {
    if (
      existsSync(join(current, "package.json")) ||
      existsSync(join(current, ".git")) ||
      existsSync(join(current, "tsconfig.json"))
    ) {
      return current;
    }
    current = resolve(current, "..");
  }

  return null;
}

/**
 * Build a trust configuration for the current environment.
 */
export function buildTrustConfig(cwd: string): TrustConfig {
  const level = assessTrust(cwd);
  const projectRoot = findProjectRoot(cwd) ?? cwd;

  return {
    level,
    projectRoot,
    hooksEnabled: level === "trusted",
    instructionsLoaded: level === "trusted",
  };
}

/**
 * Check if a path is within the trusted project root.
 */
export function isPathTrusted(filePath: string, projectRoot: string): boolean {
  const resolved = resolve(filePath);
  const resolvedRoot = resolve(projectRoot);
  return resolved.startsWith(resolvedRoot);
}
