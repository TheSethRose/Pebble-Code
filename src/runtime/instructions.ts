import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

/**
 * Repository-level instructions (AGENTS.md-first behavior).
 * Loads instruction files from the project root.
 */
export interface InstructionFile {
  path: string;
  content: string;
}

const INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  "INSTRUCTIONS.md",
];

/**
 * Ordered prompt files loaded from .pebble/prompts/.
 * Order matters: identity sets the persona, tools/safety/style layer on top.
 * Users can add, remove, or edit files to customize agent behavior.
 */
const DEFAULT_PROMPT_FILES = [
  "identity.md",
  "tools.md",
  "safety.md",
  "style.md",
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
 * Load prompt files from .pebble/prompts/ directory.
 * Reads all .md files, ordered: defaults first (in canonical order), then extras alphabetically.
 */
export function loadPromptFiles(projectRoot: string): InstructionFile[] {
  const promptDir = join(projectRoot, ".pebble", "prompts");

  if (!existsSync(promptDir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(promptDir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  // Sort: defaults in canonical order first, then any extras alphabetically
  const defaultSet = new Set(DEFAULT_PROMPT_FILES);
  const defaults = DEFAULT_PROMPT_FILES.filter((f) => entries.includes(f));
  const extras = entries.filter((f) => !defaultSet.has(f)).sort();
  const ordered = [...defaults, ...extras];

  const results: InstructionFile[] = [];
  for (const file of ordered) {
    const fullPath = join(promptDir, file);
    try {
      const content = readFileSync(fullPath, "utf-8");
      if (content.trim()) {
        results.push({ path: fullPath, content });
      }
    } catch {
      // ignore read errors
    }
  }

  return results;
}

/**
 * Format loaded prompt files into a single system prompt block.
 */
export function formatPromptFiles(files: InstructionFile[]): string {
  if (files.length === 0) return "";

  const sections = files.map((f) => f.content.trim());
  return sections.join("\n\n---\n\n");
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

/**
 * Scaffold default prompt files into .pebble/prompts/ if the directory doesn't exist.
 * Returns the path to the prompts directory.
 */
export function scaffoldPromptFiles(projectRoot: string): string {
  const promptDir = join(projectRoot, ".pebble", "prompts");

  if (existsSync(promptDir)) {
    return promptDir;
  }

  mkdirSync(promptDir, { recursive: true });

  for (const file of DEFAULT_PROMPT_FILES) {
    const bundledPath = join(projectRoot, ".pebble", "prompts", file);
    if (!existsSync(bundledPath)) {
      writeFileSync(bundledPath, `# ${basename(file, ".md")}\n\n<!-- Customize this file to change agent behavior -->\n`, "utf-8");
    }
  }

  return promptDir;
}
