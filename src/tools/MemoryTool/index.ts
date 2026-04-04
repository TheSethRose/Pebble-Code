import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  buildSessionMemory,
  formatSessionMemory,
  isSessionMemoryStale,
} from "../../persistence/memory.js";
import { TodoStore } from "../../persistence/todoStore.js";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const MemoryInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("todo_add"),
    title: z.string(),
    status: z.enum(["not-started", "in-progress", "completed"]).optional(),
  }),
  z.object({
    action: z.literal("todo_update"),
    id: z.number(),
    title: z.string().optional(),
    status: z.enum(["not-started", "in-progress", "completed"]).optional(),
  }),
  z.object({
    action: z.literal("todo_list"),
  }),
  z.object({
    action: z.literal("todo_remove"),
    id: z.number(),
  }),
  z.object({
    action: z.literal("session_memory_show"),
    refresh: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("session_memory_clear"),
  }),
  z.object({
    action: z.literal("note_add"),
    title: z.string(),
    content: z.string(),
  }),
  z.object({
    action: z.literal("note_list"),
  }),
  z.object({
    action: z.literal("note_remove"),
    id: z.number(),
  }),
]);

interface MemoryNote {
  id: number;
  title: string;
  content: string;
  createdAt: string;
}

interface MemoryNoteState {
  nextId: number;
  notes: MemoryNote[];
}

const DEFAULT_NOTE_STATE: MemoryNoteState = {
  nextId: 1,
  notes: [],
};

export class MemoryTool implements Tool {
  name = "Memory";
  aliases = ["Todo", "TodoWrite", "SessionMemory"];
  description = "Manage file-backed agent memory including todos, persisted session memory, and lightweight notes.";
  category = "memory" as const;
  capability = "memory" as const;
  inputSchema = MemoryInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = MemoryInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const todoStore = new TodoStore(context.cwd);

    switch (parsed.data.action) {
      case "todo_add": {
        const todo = todoStore.add(parsed.data.title, parsed.data.status ?? "not-started");
        return {
          success: true,
          output: `Added todo #${todo.id}: ${todo.title}`,
          data: { todo },
          summary: `Added todo ${todo.id}`,
        };
      }

      case "todo_update": {
        const todo = todoStore.update(parsed.data.id, {
          title: parsed.data.title,
          status: parsed.data.status,
        });
        if (!todo) {
          return { success: false, output: "", error: `Todo #${parsed.data.id} not found` };
        }

        return {
          success: true,
          output: `Updated todo #${todo.id}: ${todo.title} (${todo.status})`,
          data: { todo },
          summary: `Updated todo ${todo.id}`,
        };
      }

      case "todo_list": {
        const todos = todoStore.list();
        const output = todos.length > 0
          ? todos.map((todo) => `${todo.id}. [${todo.status}] ${todo.title}`).join("\n")
          : "No todos.";
        return {
          success: true,
          output,
          data: { todos },
          summary: `Listed ${todos.length} todos`,
        };
      }

      case "todo_remove": {
        const removed = todoStore.remove(parsed.data.id);
        if (!removed) {
          return { success: false, output: "", error: `Todo #${parsed.data.id} not found` };
        }
        return {
          success: true,
          output: `Removed todo #${removed.id}: ${removed.title}`,
          data: { removed },
          summary: `Removed todo ${removed.id}`,
        };
      }

      case "session_memory_show": {
        const sessionStore = context.runtime?.sessionStore;
        const sessionId = context.runtime?.sessionId;
        if (!sessionStore || !sessionId) {
          return {
            success: false,
            output: "",
            error: "Session memory requires an active runtime session.",
          };
        }

        const transcript = sessionStore.loadTranscript(sessionId);
        if (!transcript) {
          return { success: false, output: "", error: `Session not found: ${sessionId}` };
        }

        const shouldRefresh = parsed.data.refresh === true || isSessionMemoryStale(transcript.memory, transcript);
        const updated = shouldRefresh
          ? sessionStore.updateMemory(sessionId, buildSessionMemory(transcript))
          : transcript;
        const memory = updated.memory;
        if (!memory) {
          return { success: true, output: "No session memory is available yet.", data: { memory: null } };
        }

        return {
          success: true,
          output: formatSessionMemory(memory, sessionId),
          data: { memory },
          summary: shouldRefresh ? `Refreshed session memory for ${sessionId}` : `Loaded session memory for ${sessionId}`,
        };
      }

      case "session_memory_clear": {
        const sessionStore = context.runtime?.sessionStore;
        const sessionId = context.runtime?.sessionId;
        if (!sessionStore || !sessionId) {
          return {
            success: false,
            output: "",
            error: "Session memory requires an active runtime session.",
          };
        }

        sessionStore.clearMemory(sessionId);
        return {
          success: true,
          output: `Cleared session memory for ${sessionId}`,
          summary: `Cleared session memory for ${sessionId}`,
        };
      }

      case "note_add": {
        const state = readNoteState(context.cwd);
        const note: MemoryNote = {
          id: state.nextId,
          title: parsed.data.title,
          content: parsed.data.content,
          createdAt: new Date().toISOString(),
        };
        state.nextId += 1;
        state.notes.push(note);
        writeNoteState(context.cwd, state);
        return {
          success: true,
          output: `Added note #${note.id}: ${note.title}`,
          data: { note },
          summary: `Added note ${note.id}`,
        };
      }

      case "note_list": {
        const state = readNoteState(context.cwd);
        const output = state.notes.length > 0
          ? state.notes.map((note) => `${note.id}. ${note.title}\n${note.content}`).join("\n\n")
          : "No notes.";
        return {
          success: true,
          output,
          data: { notes: state.notes },
          summary: `Listed ${state.notes.length} notes`,
        };
      }

      case "note_remove": {
        const noteId = parsed.data.id;
        const state = readNoteState(context.cwd);
        const index = state.notes.findIndex((note) => note.id === noteId);
        if (index === -1) {
          return { success: false, output: "", error: `Note #${noteId} not found` };
        }
        const [removed] = state.notes.splice(index, 1);
        writeNoteState(context.cwd, state);
        return {
          success: true,
          output: `Removed note #${removed?.id}: ${removed?.title}`,
          data: { removed },
          summary: `Removed note ${removed?.id}`,
        };
      }
    }
  }
}

function getNoteStorePath(cwd: string): string {
  return join(cwd, ".pebble", "memory-notes.json");
}

function readNoteState(cwd: string): MemoryNoteState {
  const notePath = getNoteStorePath(cwd);
  if (!existsSync(notePath)) {
    return { ...DEFAULT_NOTE_STATE, notes: [] };
  }

  try {
    const raw = readFileSync(notePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MemoryNoteState>;
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter(isMemoryNote)
      : [];
    const maxId = notes.reduce((highest, note) => Math.max(highest, note.id), 0);
    return {
      nextId: typeof parsed.nextId === "number" && parsed.nextId > maxId ? parsed.nextId : maxId + 1,
      notes,
    };
  } catch {
    return { ...DEFAULT_NOTE_STATE, notes: [] };
  }
}

function writeNoteState(cwd: string, state: MemoryNoteState): void {
  const notePath = getNoteStorePath(cwd);
  const parentDir = dirname(notePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  writeFileSync(notePath, JSON.stringify(state, null, 2), "utf-8");
}

function isMemoryNote(value: unknown): value is MemoryNote {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MemoryNote>;
  return typeof candidate.id === "number"
    && typeof candidate.title === "string"
    && typeof candidate.content === "string"
    && typeof candidate.createdAt === "string";
}
