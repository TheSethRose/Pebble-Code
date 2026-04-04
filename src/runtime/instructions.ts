import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Repository-level instructions (CLAUDE.md-style behavior).
 * Loads instruction files from the project root.
 */
export interface InstructionFile {
  path: string;
  content: string;
}

const INSTRUCTION_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
  "INSTRUCTIONS.md",
];

/**
 * Load instruction files from a project root.
 */
export function loadRepositoryInstructions(projectRoot: string): InstructionFile[] {
  const results: InstructionFile[] = [];

  for (const file of INSTRUCTION_FILES) {
    const fullPath = join(projectRoot, file);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        results.push({ path: fullPath, content });
      } catch {
        // ignore read errors
      }
    }
  }

  return results;
}

/**
 * Format loaded instructions for injection into the system prompt.
 */
export function formatInstructions(files: InstructionFile[]): string {
  if (files.length === 0) return "";

  const sections = files.map((f) => {
    const filename = f.path.split("/").pop() ?? f.path;
    return `## ${filename}\n\n${f.content}`;
  });

  return `# Repository Instructions\n\n${sections.join("\n\n---\n\n")}`;
}
