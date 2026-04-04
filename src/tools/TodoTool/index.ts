/**
 * TodoTool — task tracker for multi-step work.
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const TodoInputSchema = z.object({
  action: z.enum(["add", "update", "list", "remove"]).describe("Action to perform"),
  id: z.number().optional().describe("Task ID (required for update/remove)"),
  title: z.string().optional().describe("Task title (required for add, optional for update)"),
  status: z.enum(["not-started", "in-progress", "completed"]).optional().describe("Task status (for add/update)"),
});

interface TodoItem {
  id: number;
  title: string;
  status: "not-started" | "in-progress" | "completed";
}

let nextId = 1;
const todos: TodoItem[] = [];

export class TodoTool implements Tool {
  name = "Todo";
  description = "Manage a structured todo list to track progress on multi-step tasks. Use add, update, list, and remove actions.";

  inputSchema = TodoInputSchema;

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const parsed = TodoInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const { action, id, title, status } = parsed.data;

    switch (action) {
      case "add": {
        if (!title) {
          return { success: false, output: "", error: "title is required for add action" };
        }
        const todo: TodoItem = { id: nextId++, title, status: status ?? "not-started" };
        todos.push(todo);
        return {
          success: true,
          output: `Added todo #${todo.id}: ${todo.title}`,
          data: { todo },
        };
      }

      case "update": {
        if (id === undefined) {
          return { success: false, output: "", error: "id is required for update action" };
        }
        const todo = todos.find((t) => t.id === id);
        if (!todo) {
          return { success: false, output: "", error: `Todo #${id} not found` };
        }
        if (title) todo.title = title;
        if (status) todo.status = status;
        return {
          success: true,
          output: `Updated todo #${todo.id}: ${todo.title} (${todo.status})`,
          data: { todo },
        };
      }

      case "list": {
        if (todos.length === 0) {
          return { success: true, output: "No todos", data: { todos: [] } };
        }
        const output = todos
          .map((t) => {
            const icon = t.status === "completed" ? "✅" : t.status === "in-progress" ? "🔄" : "⬜";
            return `${icon} #${t.id}: ${t.title}`;
          })
          .join("\n");
        return { success: true, output, data: { todos } };
      }

      case "remove": {
        if (id === undefined) {
          return { success: false, output: "", error: "id is required for remove action" };
        }
        const index = todos.findIndex((t) => t.id === id);
        if (index === -1) {
          return { success: false, output: "", error: `Todo #${id} not found` };
        }
        const removed = todos.splice(index, 1)[0];
        return { success: true, output: `Removed todo #${removed!.id}: ${removed!.title}`, data: { removed } };
      }
    }
  }
}
