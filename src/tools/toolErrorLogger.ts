/**
 * Tool error logger — records tool failures for post-hoc analysis.
 *
 * Writes a JSONL file at the project root (`.pebble-tool-errors.jsonl`)
 * that captures structured details about each tool invocation failure.
 * The file is git-ignored local metadata, not source content.
 */

import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ToolErrorEntry {
  timestamp: string;
  sessionId: string | null;
  turnCount: number;
  toolName: string;
  toolCallId: string;
  inputAttempt: unknown;
  errorMessage: string;
  errorCategory: ToolErrorCategory;
  recoveryHints: string[];
}

export type ToolErrorCategory =
  | "validation"          // Zod schema mismatch / invalid_union_discriminator
  | "not_found"            // Unknown tool name
  | "execution"            // Runtime exception during execute()
  | "permission_denied"    // User/permission system rejected the call
  | "timeout"              // Tool exceeded its time budget
  | "interrupted"          // User interrupted mid-execution
  | (string & {});

/**
 * Detect a structured error category from the error message text.
 */
export function categorizeToolError(errorMessage: string): ToolErrorCategory {
  const msg = errorMessage.toLowerCase();
  if (
    msg.includes("invalid_union_discriminator") ||
    msg.includes("invalid_type") ||
    msg.includes("invalid_literal") ||
    msg.includes("invalid_enum_value") ||
    msg.includes("invalid input") ||
    msg.includes("expected")
  ) {
    return "validation";
  }
  if (msg.includes("unknown tool") || msg.includes("tool not found")) {
    return "not_found";
  }
  if (msg.includes("denied") || msg.includes("permission") || msg.includes("unauthorized")) {
    return "permission_denied";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  return "execution";
}

/**
 * Extract structured recovery hints from a Zod validation error.
 */
export function extractRecoveryHints(errorMessage: string, toolName: string): string[] {
  const hints: string[] = [];

  // Extract discriminator options from invalid_union_discriminator errors
  const discriminatorMatch = errorMessage.match(/"options":\s*\[([^\]]+)\]/);
  if (discriminatorMatch) {
    try {
      const options = JSON.parse(`[${discriminatorMatch[1]}]`) as string[];
      if (Array.isArray(options) && options.length > 0) {
        hints.push(`Valid ${toolName} action values are: ${options.join(", ")}. Choose exactly one.`);
      }
    } catch {
      // Fall through to raw hint
    }
  }

  // Extract enum value expectations
  const enumMatch = errorMessage.match(/Invalid enum value\. Expected '([^']+)',? received '([^']+)'/i);
  if (enumMatch) {
    hints.push(`Expected one of: '${enumMatch[1]}', but received '${enumMatch[2]}'.`);
  }

  // Extract literal expectations
  const literalMatch = errorMessage.match(/Invalid literal value, expected ["']([^"']+)["']/i);
  if (literalMatch) {
    hints.push(`Expected the literal value "${literalMatch[1]}".`);
  }

  // Extract type mismatch
  const typeMatch = errorMessage.match(/Expected (\w+), received (\w+)/i);
  if (typeMatch) {
    hints.push(`Type mismatch: expected ${typeMatch[1]}, but received ${typeMatch[2]}.`);
  }

  // Extract required field errors
  const requiredMatch = errorMessage.match(/Required/i);
  if (requiredMatch) {
    hints.push(`A required field is missing from the input object.`);
  }

  return hints;
}

/**
 * Build a rich, model-readable error message with recovery guidance.
 */
export function buildRecoveryErrorMessage(
  toolName: string,
  errorMessage: string,
  category: ToolErrorCategory,
  hints: string[],
): string {
  const parts: string[] = [];

  parts.push(`TOOL ERROR: ${toolName} failed.`);
  parts.push(`Category: ${category}`);
  parts.push(`Details: ${errorMessage}`);

  if (hints.length > 0) {
    parts.push("\nRECOVERY GUIDANCE:");
    for (const hint of hints) {
      parts.push(`  - ${hint}`);
    }
    parts.push("\nPlease retry the tool call with corrected input.");
  }

  return parts.join("\n");
}

/**
 * Append a tool error entry to the JSONL log.
 *
 * The log file lives at the project root as `.pebble-tool-errors.jsonl`
 * and is append-only. Each line is a self-contained JSON entry.
 */
export async function logToolError(entry: ToolErrorEntry): Promise<void> {
  const logPath = join(process.cwd(), ".pebble-tool-errors.jsonl");
  const line = JSON.stringify(entry);

  try {
    appendFileSync(logPath, line + "\n", "utf-8");
  } catch {
    // Best-effort — fail silently if the log file can't be written
  }

  return Promise.resolve();
}
