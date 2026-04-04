import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Message } from "../src/engine/types";
import { QueryEngine } from "../src/engine/QueryEngine";
import type { Provider, ProviderCapabilities, ProviderOptions, ProviderResponse, StreamChunk } from "../src/providers/types";
import { getTodoStorePath } from "../src/persistence/todoStore";
import { ApplyPatchTool } from "../src/tools/ApplyPatchTool";
import { AskUserQuestionTool } from "../src/tools/AskUserQuestionTool";
import { FileWriteTool } from "../src/tools/FileWriteTool";
import { TodoTool } from "../src/tools/TodoTool";

const tempDirs: string[] = [];

function createTempProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: prefix }, null, 2), "utf-8");
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

class ScriptedProvider implements Provider {
  readonly id = "scripted";
  readonly name = "Scripted Provider";
  readonly model = "scripted-model";

  completeCalls: Message[][] = [];

  constructor(
    private readonly onComplete: (messages: Message[], callNumber: number) => ProviderResponse | Promise<ProviderResponse>,
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: false,
      toolUse: true,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      parallelToolCalls: false,
    };
  }

  async complete(messages: Message[], _options?: ProviderOptions): Promise<ProviderResponse> {
    this.completeCalls.push(messages.map((message) => ({ ...message })));
    return this.onComplete(messages, this.completeCalls.length);
  }

  async *stream(_messages: Message[], _options?: ProviderOptions): AsyncIterable<StreamChunk> {
    throw new Error("Streaming not implemented in ScriptedProvider test double");
  }

  isConfigured(): boolean {
    return true;
  }
}

describe("tool persistence and file operations", () => {
  test("TodoTool persists state across tool instances and process-like restarts", async () => {
    const projectDir = createTempProject("pebble-tools-todo-");

    const firstTool = new TodoTool();
    const secondTool = new TodoTool();

    const addResult = await firstTool.execute(
      { action: "add", title: "Ship persistent todos", status: "in-progress" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(addResult.success).toBe(true);
    expect(existsSync(getTodoStorePath(projectDir))).toBe(true);

    const listResult = await secondTool.execute(
      { action: "list" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain("#1: Ship persistent todos");

    const persisted = JSON.parse(readFileSync(getTodoStorePath(projectDir), "utf-8")) as {
      nextId: number;
      todos: Array<{ id: number; title: string; status: string }>;
    };

    expect(persisted.nextId).toBe(2);
    expect(persisted.todos).toEqual([
      { id: 1, title: "Ship persistent todos", status: "in-progress" },
    ]);
  });

  test("TodoTool storage is isolated per project root", async () => {
    const firstProject = createTempProject("pebble-tools-first-");
    const secondProject = createTempProject("pebble-tools-second-");
    const tool = new TodoTool();

    await tool.execute(
      { action: "add", title: "First project task" },
      { cwd: firstProject, permissionMode: "always-ask" },
    );
    await tool.execute(
      { action: "add", title: "Second project task" },
      { cwd: secondProject, permissionMode: "always-ask" },
    );

    const firstList = await tool.execute(
      { action: "list" },
      { cwd: firstProject, permissionMode: "always-ask" },
    );
    const secondList = await tool.execute(
      { action: "list" },
      { cwd: secondProject, permissionMode: "always-ask" },
    );

    expect(firstList.output).toContain("First project task");
    expect(firstList.output).not.toContain("Second project task");
    expect(secondList.output).toContain("Second project task");
    expect(secondList.output).not.toContain("First project task");
  });

  test("FileWriteTool creates a new file and protects existing files by default", async () => {
    const projectDir = createTempProject("pebble-tools-write-");
    const tool = new FileWriteTool();

    const createResult = await tool.execute(
      { file_path: "src/generated.txt", content: "hello world\n" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(createResult.success).toBe(true);
    expect(readFileSync(join(projectDir, "src/generated.txt"), "utf-8")).toBe("hello world\n");

    const overwriteResult = await tool.execute(
      { file_path: "src/generated.txt", content: "changed" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(overwriteResult.success).toBe(false);
    expect(overwriteResult.error).toContain("Set overwrite=true");
  });

  test("ApplyPatchTool patches existing files and creates new files", async () => {
    const projectDir = createTempProject("pebble-tools-patch-");
    writeFileSync(join(projectDir, "notes.txt"), "alpha\nbeta\n", "utf-8");
    const tool = new ApplyPatchTool();

    const result = await tool.execute(
      {
        patch: [
          "--- a/notes.txt",
          "+++ b/notes.txt",
          "@@ -1,2 +1,2 @@",
          " alpha",
          "-beta",
          "+gamma",
          "--- /dev/null",
          "+++ b/new-file.txt",
          "@@ -0,0 +1,2 @@",
          "+first",
          "+second",
        ].join("\n"),
      },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Patched notes.txt");
    expect(result.output).toContain("Created new-file.txt");
    expect(readFileSync(join(projectDir, "notes.txt"), "utf-8")).toBe("alpha\ngamma\n");
    expect(readFileSync(join(projectDir, "new-file.txt"), "utf-8")).toBe("first\nsecond\n");
  });
});

describe("AskUserQuestion interactive loop", () => {
  test("QueryEngine waits for a user answer and feeds it back into the tool loop", async () => {
    const provider = new ScriptedProvider((messages, callNumber) => {
      if (callNumber === 1) {
        expect(messages).toEqual([{ role: "user", content: "Pick a deployment target" }]);

        return {
          text: "I need your choice before continuing.",
          toolCalls: [
            {
              id: "ask-1",
              name: "AskUserQuestion",
              input: {
                question: "Where should I deploy this?",
                options: ["staging", "production"],
                allow_freeform: false,
              },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 8, outputTokens: 5 },
        };
      }

      if (callNumber === 2) {
        const toolResult = messages.at(-1);
        expect(toolResult).toMatchObject({
          role: "tool",
          toolName: "AskUserQuestion",
          content: "staging",
        });

        return {
          text: "Deploying to staging.",
          toolCalls: [],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 4 },
        };
      }

      throw new Error(`Unexpected provider call ${callNumber}`);
    });

    const prompts: string[] = [];
    const engine = new QueryEngine({
      provider,
      tools: [new AskUserQuestionTool()],
      resolveQuestion: async (request) => {
        prompts.push(`${request.question}:${request.options.join(",")}`);
        return "staging";
      },
    });

    const result = await engine.process([{ role: "user", content: "Pick a deployment target" }]);

    expect(result.success).toBe(true);
    expect(prompts).toEqual(["Where should I deploy this?:staging,production"]);
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Deploying to staging.",
    });
  });
});