import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export interface NotebookCell {
  cell_type: "markdown" | "code";
  id: string;
  metadata: Record<string, unknown>;
  source: string[];
  outputs?: Array<Record<string, unknown>>;
  execution_count?: number | null;
}

export interface NotebookDocument {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

export function createNotebook(cells: NotebookCell[] = []): NotebookDocument {
  return {
    cells,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export function loadNotebook(filePath: string): NotebookDocument {
  if (!existsSync(filePath)) {
    return createNotebook();
  }

  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as NotebookDocument;
}

export function saveNotebook(filePath: string, notebook: NotebookDocument): void {
  const parentDir = dirname(filePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(notebook, null, 2), "utf-8");
}

export function ensureCellId(id?: string): string {
  return id ?? `cell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toSourceLines(source: string | string[]): string[] {
  const lines = Array.isArray(source) ? source.join("") : source;
  return lines.split(/(?<=\n)/);
}

export function getCellBySelector(
  notebook: NotebookDocument,
  selector: { index?: number; id?: string },
): { cell: NotebookCell; index: number } | null {
  if (typeof selector.index === "number") {
    const cell = notebook.cells[selector.index];
    return cell ? { cell, index: selector.index } : null;
  }

  if (selector.id) {
    const index = notebook.cells.findIndex((cell) => cell.id === selector.id);
    return index >= 0 ? { cell: notebook.cells[index]!, index } : null;
  }

  return null;
}
