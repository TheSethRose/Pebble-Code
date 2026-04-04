import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";
import { resolveWorkspacePath, truncateText } from "../shared/common.js";
import {
  createNotebook,
  ensureCellId,
  getCellBySelector,
  loadNotebook,
  saveNotebook,
  toSourceLines,
  type NotebookCell,
} from "../shared/notebook.js";

const NotebookInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_notebook"),
    file_path: z.string(),
    language: z.enum(["python", "javascript", "typescript", "markdown"]).optional(),
  }),
  z.object({
    action: z.literal("summary"),
    file_path: z.string(),
  }),
  z.object({
    action: z.literal("edit_cell"),
    file_path: z.string(),
    edit_mode: z.enum(["insert", "replace", "delete"]),
    index: z.number().optional(),
    id: z.string().optional(),
    cell_type: z.enum(["code", "markdown"]).optional(),
    source: z.union([z.string(), z.array(z.string())]).optional(),
  }),
  z.object({
    action: z.literal("run_cell"),
    file_path: z.string(),
    index: z.number().optional(),
    id: z.string().optional(),
    language: z.enum(["python", "javascript", "typescript"]).optional(),
  }),
  z.object({
    action: z.literal("read_output"),
    file_path: z.string(),
    index: z.number().optional(),
    id: z.string().optional(),
  }),
]);

export class NotebookTool implements Tool {
  name = "Notebook";
  aliases = ["CreateNewJupyterNotebook", "NotebookSummary", "RunNotebookCell", "ReadCellOutput", "EditNotebook"];
  description = "Create, inspect, edit, and run notebook cells through a single notebook workflow tool.";
  category = "notebook" as const;
  capability = "notebook" as const;
  inputSchema = NotebookInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = NotebookInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const filePath = resolveWorkspacePath(parsed.data.file_path, context.cwd);

    switch (parsed.data.action) {
      case "create_notebook": {
        const notebook = createNotebook();
        notebook.metadata.language_info = { name: parsed.data.language ?? "python" };
        notebook.metadata.kernelspec = {
          display_name: parsed.data.language ?? "python",
          language: parsed.data.language ?? "python",
          name: parsed.data.language ?? "python3",
        };
        saveNotebook(filePath, notebook);
        return {
          success: true,
          output: `Created notebook ${parsed.data.file_path}`,
          data: { filePath },
          summary: `Created notebook ${parsed.data.file_path}`,
        };
      }

      case "summary": {
        const notebook = loadNotebook(filePath);
        const lines = notebook.cells.map((cell, index) => {
          const firstLine = cell.source.join("").trim().split("\n")[0] ?? "";
          return `${index}. ${cell.cell_type} [${cell.id}] ${firstLine}`.trim();
        });
        return {
          success: true,
          output: lines.length > 0 ? lines.join("\n") : "Notebook has no cells.",
          data: {
            cellCount: notebook.cells.length,
            cells: notebook.cells.map((cell, index) => ({
              index,
              id: cell.id,
              cell_type: cell.cell_type,
              sourcePreview: cell.source.join("").trim().slice(0, 120),
              outputCount: cell.outputs?.length ?? 0,
            })),
          },
          summary: `Summarized ${notebook.cells.length} notebook cells`,
        };
      }

      case "edit_cell": {
        const notebook = loadNotebook(filePath);
        if (parsed.data.edit_mode === "insert") {
          const newCell: NotebookCell = {
            cell_type: parsed.data.cell_type ?? "code",
            id: ensureCellId(),
            metadata: {},
            source: toSourceLines(parsed.data.source ?? ""),
            outputs: parsed.data.cell_type === "code" ? [] : undefined,
            execution_count: parsed.data.cell_type === "code" ? null : undefined,
          };
          const index = typeof parsed.data.index === "number"
            ? Math.max(0, Math.min(parsed.data.index, notebook.cells.length))
            : notebook.cells.length;
          notebook.cells.splice(index, 0, newCell);
          saveNotebook(filePath, notebook);
          return {
            success: true,
            output: `Inserted ${newCell.cell_type} cell at index ${index}`,
            data: { index, cell: newCell },
            summary: `Inserted notebook cell ${newCell.id}`,
          };
        }

        const located = getCellBySelector(notebook, { index: parsed.data.index, id: parsed.data.id });
        if (!located) {
          return { success: false, output: "", error: "Cell not found." };
        }

        if (parsed.data.edit_mode === "delete") {
          notebook.cells.splice(located.index, 1);
          saveNotebook(filePath, notebook);
          return {
            success: true,
            output: `Deleted cell ${located.cell.id}`,
            data: { id: located.cell.id, index: located.index },
            summary: `Deleted notebook cell ${located.cell.id}`,
          };
        }

        located.cell.source = toSourceLines(parsed.data.source ?? "");
        if (parsed.data.cell_type) {
          located.cell.cell_type = parsed.data.cell_type;
        }
        saveNotebook(filePath, notebook);
        return {
          success: true,
          output: `Updated cell ${located.cell.id}`,
          data: { index: located.index, cell: located.cell },
          summary: `Updated notebook cell ${located.cell.id}`,
        };
      }

      case "run_cell": {
        const notebook = loadNotebook(filePath);
        const located = getCellBySelector(notebook, { index: parsed.data.index, id: parsed.data.id });
        if (!located) {
          return { success: false, output: "", error: "Cell not found." };
        }
        if (located.cell.cell_type !== "code") {
          return { success: false, output: "", error: "Only code cells can be executed." };
        }

        const language = parsed.data.language ?? getNotebookLanguage(notebook.metadata);
        const execution = await executeCodeCell(language, located.cell.source.join(""));
        located.cell.outputs = [
          {
            output_type: execution.success ? "stream" : "error",
            name: execution.success ? "stdout" : "stderr",
            text: [execution.output],
          },
        ];
        located.cell.execution_count = (located.cell.execution_count ?? 0) + 1;
        saveNotebook(filePath, notebook);

        return {
          success: execution.success,
          output: execution.output,
          error: execution.success ? undefined : execution.error,
          data: {
            index: located.index,
            id: located.cell.id,
            language,
          },
          summary: `Executed notebook cell ${located.cell.id}`,
        };
      }

      case "read_output": {
        const notebook = loadNotebook(filePath);
        const located = getCellBySelector(notebook, { index: parsed.data.index, id: parsed.data.id });
        if (!located) {
          return { success: false, output: "", error: "Cell not found." };
        }

        const output = (located.cell.outputs ?? [])
          .map((item) => {
            const text = item.text;
            return Array.isArray(text) ? text.join("") : JSON.stringify(item);
          })
          .join("\n\n") || "(no output)";
        const truncated = truncateText(output, 12_000, "\n\n[Cell output truncated]");

        return {
          success: true,
          output: truncated.text,
          truncated: truncated.truncated,
          data: {
            id: located.cell.id,
            index: located.index,
            outputCount: located.cell.outputs?.length ?? 0,
          },
          summary: `Read notebook cell output for ${located.cell.id}`,
        };
      }
    }
  }
}

async function executeCodeCell(
  language: string,
  source: string,
): Promise<{ success: boolean; output: string; error?: string }> {
  const tempDir = mkdtempSync(join(tmpdir(), "pebble-notebook-"));
  const normalizedLanguage = language.toLowerCase();
  const extension = normalizedLanguage === "python" ? "py" : "ts";
  const filePath = join(tempDir, `cell.${extension}`);
  writeFileSync(filePath, source, "utf-8");

  const cmd = normalizedLanguage === "python"
    ? ["python3", filePath]
    : ["bun", filePath];

  const result = Bun.spawnSync({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
  });
  rmSync(tempDir, { recursive: true, force: true });

  const stdout = result.stdout.toString("utf-8").trim();
  const stderr = result.stderr.toString("utf-8").trim();
  const output = [stdout, stderr].filter(Boolean).join("\n\n") || "(no output)";
  return {
    success: result.exitCode === 0,
    output,
    error: result.exitCode === 0 ? undefined : `Cell execution failed with exit code ${result.exitCode}`,
  };
}

function getNotebookLanguage(metadata: Record<string, unknown>): string {
  const languageInfo = metadata.language_info;
  if (languageInfo && typeof languageInfo === "object" && "name" in languageInfo && typeof languageInfo.name === "string") {
    return languageInfo.name;
  }

  const kernelspec = metadata.kernelspec;
  if (kernelspec && typeof kernelspec === "object" && "language" in kernelspec && typeof kernelspec.language === "string") {
    return kernelspec.language;
  }

  return "python";
}
