/**
 * Extension loader for MCP, plugins, and skills.
 * Isolates extension failures from core runtime.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Extension } from "./contracts.js";

export interface ExtensionManifest {
  name: string;
  version: string;
  type: "mcp" | "plugin" | "skill";
  description?: string;
}

export interface ExtensionResult {
  manifest: ExtensionManifest;
  loaded: boolean;
  error?: string;
  extension?: Extension;
  entryPath?: string;
}

const SUPPORTED_EXTENSION_SUFFIXES = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

export function getDefaultExtensionDirs(cwd: string): string[] {
  return [
    join(cwd, "extensions"),
    join(cwd, ".pebble", "extensions"),
  ];
}

/**
 * Load extensions from a directory.
 * Failures are isolated — bad extensions don't break the core.
 */
export async function loadExtensions(
  extensionDirs: string[],
): Promise<ExtensionResult[]> {
  const results: ExtensionResult[] = [];

  for (const dir of extensionDirs) {
    for (const entryPath of discoverExtensionEntries(dir)) {
      try {
        const moduleUrl = pathToFileURL(resolve(entryPath)).href;
        const loaded = await import(moduleUrl);
        const extension = resolveExtensionExport(loaded);

        if (extension.hooks?.onActivate) {
          await extension.hooks.onActivate();
        }

        results.push({
          manifest: {
            name: extension.metadata.name,
            version: extension.metadata.version,
            type: "plugin",
            description: extension.metadata.description,
          },
          loaded: true,
          extension,
          entryPath,
        });
      } catch (error) {
        results.push({
          manifest: {
            name: basename(entryPath),
            version: "0.0.0",
            type: "plugin",
          },
          loaded: false,
          error: error instanceof Error ? error.message : String(error),
          entryPath,
        });
      }
    }
  }

  return results;
}

/**
 * Report extension loading status.
 */
export function reportExtensionStatus(results: ExtensionResult[]): void {
  const loaded = results.filter((r) => r.loaded).length;
  const failed = results.filter((r) => !r.loaded).length;

  if (loaded > 0) {
    console.error(`Loaded ${loaded} extension(s)`);
  }
  if (failed > 0) {
    console.error(`Failed to load ${failed} extension(s):`);
    for (const result of results.filter((r) => !r.loaded)) {
      console.error(`  - ${result.manifest.name}: ${result.error}`);
    }
  }
}

function discoverExtensionEntries(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir)
    .map((name) => join(dir, name))
    .flatMap((entryPath) => {
      const stats = statSync(entryPath);
      if (stats.isDirectory()) {
        return [
          join(entryPath, "index.ts"),
          join(entryPath, "index.js"),
          join(entryPath, "index.mjs"),
          join(entryPath, "index.cjs"),
        ].filter((candidate) => existsSync(candidate));
      }

      return SUPPORTED_EXTENSION_SUFFIXES.has(extname(entryPath)) ? [entryPath] : [];
    });

  return entries.sort((a, b) => a.localeCompare(b));
}

function resolveExtensionExport(loaded: Record<string, unknown>): Extension {
  const candidate = loaded.default ?? loaded.extension;
  if (!isExtension(candidate)) {
    throw new Error("Module does not export a valid extension");
  }

  return candidate;
}

function isExtension(value: unknown): value is Extension {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Extension>;
  return Boolean(
    candidate.metadata
      && typeof candidate.metadata.id === "string"
      && typeof candidate.metadata.name === "string"
      && typeof candidate.metadata.version === "string",
  );
}
