/**
 * Extension loader for MCP, plugins, and skills.
 * Isolates extension failures from core runtime.
 */

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
    try {
      // Stub: would load actual extensions
      results.push({
        manifest: {
          name: dir.split("/").pop() ?? "unknown",
          version: "0.0.0",
          type: "plugin",
        },
        loaded: false,
        error: "Extension loading not yet implemented",
      });
    } catch (error) {
      results.push({
        manifest: {
          name: dir.split("/").pop() ?? "unknown",
          version: "0.0.0",
          type: "plugin",
        },
        loaded: false,
        error: error instanceof Error ? error.message : String(error),
      });
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
