import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findProjectRoot } from "../runtime/trust.js";

export type TodoStatus = "not-started" | "in-progress" | "completed";

export interface TodoItem {
  id: number;
  title: string;
  status: TodoStatus;
}

interface PersistedTodoState {
  nextId: number;
  todos: TodoItem[];
}

const DEFAULT_STATE: PersistedTodoState = {
  nextId: 1,
  todos: [],
};

export function getTodoStorePath(cwd: string): string {
  const projectRoot = findProjectRoot(cwd) ?? cwd;
  return join(projectRoot, ".pebble", "todos.json");
}

export class TodoStore {
  constructor(private readonly cwd: string) {}

  list(): TodoItem[] {
    return [...this.readState().todos];
  }

  add(title: string, status: TodoStatus = "not-started"): TodoItem {
    const state = this.readState();
    const todo: TodoItem = {
      id: state.nextId,
      title,
      status,
    };

    state.nextId += 1;
    state.todos.push(todo);
    this.writeState(state);
    return todo;
  }

  update(id: number, updates: Partial<Pick<TodoItem, "title" | "status">>): TodoItem | null {
    const state = this.readState();
    const todo = state.todos.find((item) => item.id === id);
    if (!todo) {
      return null;
    }

    if (typeof updates.title === "string") {
      todo.title = updates.title;
    }

    if (updates.status) {
      todo.status = updates.status;
    }

    this.writeState(state);
    return todo;
  }

  remove(id: number): TodoItem | null {
    const state = this.readState();
    const index = state.todos.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }

    const [removed] = state.todos.splice(index, 1);
    this.writeState(state);
    return removed ?? null;
  }

  private readState(): PersistedTodoState {
    const filePath = getTodoStorePath(this.cwd);
    if (!existsSync(filePath)) {
      return { ...DEFAULT_STATE, todos: [] };
    }

    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PersistedTodoState>;
      const todos = Array.isArray(parsed.todos)
        ? parsed.todos.filter(isTodoItem)
        : [];
      const maxId = todos.reduce((highest, todo) => Math.max(highest, todo.id), 0);
      const nextId = typeof parsed.nextId === "number" && parsed.nextId > maxId
        ? parsed.nextId
        : maxId + 1;

      return {
        nextId,
        todos,
      };
    } catch {
      return { ...DEFAULT_STATE, todos: [] };
    }
  }

  private writeState(state: PersistedTodoState): void {
    const filePath = getTodoStorePath(this.cwd);
    const dirPath = dirname(filePath);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  }
}

function isTodoItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TodoItem>;
  return typeof candidate.id === "number"
    && typeof candidate.title === "string"
    && (candidate.status === "not-started"
      || candidate.status === "in-progress"
      || candidate.status === "completed");
}