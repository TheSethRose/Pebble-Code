/**
 * TodoTool — task tracker for multi-step work.
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";
import { TodoStore, type TodoItem } from "../../persistence/todoStore.js";

const TodoInputSchema = z.object({
  action: z.enum(["add", "update", "list", "remove"]).describe("Action to perform"),
  id: z.number().optional().describe("Task ID (required for update/remove)"),
  title: z.string().optional().describe("Task title (required for add, optional for update)"),
  status: z.enum(["not-started", "in-progress", "completed"]).optional().describe("Task status (for add/update)"),
});

export class TodoTool implements Tool {
  name = "Todo";
  description = "Manage a structured todo list to track progress on multi-step tasks. Use add, update, list, and remove actions.";

  inputSchema = TodoInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = TodoInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const { action, id, title, status } = parsed.data;
    const store = new TodoStore(context.cwd);

    switch (action) {
      case "add": {
        if (!title) {
          return { success: false, output: "", error: "title is required for add action" };
        }
        const todo = store.add(title, status ?? "not-started");
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
        const todo = store.update(id, { title, status });
        if (!todo) {
          return { success: false, output: "", error: `Todo #${id} not found` };
        }
        return {
          success: true,
          output: `Updated todo #${todo.id}: ${todo.title} (${todo.status})`,
          data: { todo },
        };
      }

      case "list": {
        const todos = store.list();
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
        const removed = store.remove(id);
        if (!removed) {
          return { success: false, output: "", error: `Todo #${id} not found` };
        }
        return { success: true, output: `Removed todo #${removed.id}: ${removed.title}`, data: { removed } };
      }
    }
  }
}
