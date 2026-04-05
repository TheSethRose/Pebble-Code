import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Message } from "../src/engine/types";
import { QueryEngine } from "../src/engine/QueryEngine";
import type { Provider, ProviderCapabilities, ProviderOptions, ProviderResponse, StreamChunk } from "../src/providers/types";
import { failPendingApprovalsForResume, createProjectSessionStore } from "../src/persistence/runtimeSessions";
import { getTodoStorePath } from "../src/persistence/todoStore";
import { PermissionManager } from "../src/runtime/permissionManager";
import { ApplyPatchTool } from "../src/tools/ApplyPatchTool";
import { AskUserQuestionTool } from "../src/tools/AskUserQuestionTool";
import { FileWriteTool } from "../src/tools/FileWriteTool";
import { IntegrationTool } from "../src/tools/IntegrationTool";
import { MemoryTool } from "../src/tools/MemoryTool";
import { NotebookTool } from "../src/tools/NotebookTool";
import { createMvpTools } from "../src/tools/orchestration";
import { OrchestrateTool } from "../src/tools/OrchestrateTool";
import { ToolRegistry } from "../src/tools/registry";
import { ShellTool } from "../src/tools/ShellTool";
import { TodoTool } from "../src/tools/TodoTool";
import { UserInteractionTool } from "../src/tools/UserInteractionTool";
import { WebTool } from "../src/tools/WebTool";
import { WorkspaceEditTool } from "../src/tools/WorkspaceEditTool";
import { WorkspaceReadTool } from "../src/tools/WorkspaceReadTool";

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

describe("capability tool registry and alias resolution", () => {
  test("createMvpTools exposes the consolidated capability surface", () => {
    const tools = createMvpTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "WorkspaceRead",
      "WorkspaceEdit",
      "Shell",
      "UserInteraction",
      "Memory",
      "Web",
      "Notebook",
      "Orchestrate",
      "Integration",
    ]);
  });

  test("ToolRegistry resolves legacy aliases to canonical capability tools", () => {
    const registry = new ToolRegistry();
    registry.registerMany(createMvpTools());

    expect(registry.get("FileRead")?.name).toBe("WorkspaceRead");
    expect(registry.get("ApplyPatch")?.name).toBe("WorkspaceEdit");
    expect(registry.get("AskUserQuestion")?.name).toBe("UserInteraction");
    expect(registry.get("WebFetch")?.name).toBe("Web");
    expect(registry.get("ExecutionSubagent")?.name).toBe("Orchestrate");
  });

  test("QueryEngine can satisfy a legacy FileRead tool call through WorkspaceRead", async () => {
    const projectDir = createTempProject("pebble-tools-workspace-read-");
    writeFileSync(join(projectDir, "notes.txt"), "hello from alias\n", "utf-8");

    const provider = new ScriptedProvider((messages, callNumber) => {
      if (callNumber === 1) {
        return {
          text: "Reading the file.",
          toolCalls: [{ id: "alias-read", name: "FileRead", input: { action: "read_file", file_path: "notes.txt" } }],
          stopReason: "tool_use",
          usage: { inputTokens: 3, outputTokens: 3 },
        };
      }

      expect(messages.at(-1)).toMatchObject({
        role: "tool",
        toolName: "WorkspaceRead",
        content: "hello from alias\n",
      });

      return {
        text: "Done reading.",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 3, outputTokens: 2 },
      };
    });

    const engine = new QueryEngine({
      provider,
      tools: [new WorkspaceReadTool()],
      cwd: projectDir,
    });

    const result = await engine.process([{ role: "user", content: "read notes.txt" }]);
    expect(result.success).toBe(true);
    expect(result.messages.at(-2)).toMatchObject({
      role: "tool",
      toolName: "WorkspaceRead",
      metadata: {
        requestedToolName: "FileRead",
      },
    });
  });

  test("WorkspaceRead provider definition exposes action-picking guidance to the model", () => {
    const engine = new QueryEngine({
      provider: new ScriptedProvider(() => ({
        text: "done",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
      tools: [new WorkspaceReadTool()],
    });

    const defs = (engine as any).getProviderToolDefinitions() as Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>;
    const workspaceRead = defs.find((definition) => definition.name === "WorkspaceRead");

    expect(workspaceRead).toBeDefined();
    expect(workspaceRead?.description).toContain("project_structure");
    expect(workspaceRead?.description).toContain("JSON-typed booleans/numbers");
    expect(JSON.stringify(workspaceRead?.inputSchema ?? {})).toContain("Optional recursion depth");
    expect(JSON.stringify(workspaceRead?.inputSchema ?? {})).toContain("Read file contents when you already know the file path");
  });
});

describe("capability tool implementations", () => {
  test("WorkspaceRead tolerates string boolean flags for directory listing", async () => {
    const projectDir = createTempProject("pebble-tools-workspace-read-booleanish-");
    writeFileSync(join(projectDir, "visible.txt"), "hello\n", "utf-8");
    writeFileSync(join(projectDir, ".hidden.txt"), "secret\n", "utf-8");

    const tool = new WorkspaceReadTool();
    const hiddenOff = await tool.execute(
      { action: "list_directory", include_hidden: "false" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    const hiddenOn = await tool.execute(
      { action: "list_directory", include_hidden: "true" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(hiddenOff.success).toBe(true);
    expect(hiddenOff.output).toContain("visible.txt");
    expect(hiddenOff.output).not.toContain(".hidden.txt");

    expect(hiddenOn.success).toBe(true);
    expect(hiddenOn.output).toContain("visible.txt");
    expect(hiddenOn.output).toContain(".hidden.txt");
  });

  test("WorkspaceRead tolerates numeric string fields for project structure and limits", async () => {
    const projectDir = createTempProject("pebble-tools-workspace-read-numberish-");
    mkdirSync(join(projectDir, "src", "nested", "deeper"), { recursive: true });
    writeFileSync(join(projectDir, "src", "nested", "deeper", "file.txt"), "hello\n", "utf-8");
    writeFileSync(join(projectDir, "one.txt"), "1\n", "utf-8");
    writeFileSync(join(projectDir, "two.txt"), "2\n", "utf-8");
    writeFileSync(join(projectDir, "three.txt"), "3\n", "utf-8");

    const tool = new WorkspaceReadTool();
    const projectStructure = await tool.execute(
      { action: "project_structure", path: ".", max_depth: "2", max_entries_per_directory: "20" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    const directoryListing = await tool.execute(
      { action: "list_directory", path: ".", max_results: "2" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(projectStructure.success).toBe(true);
    expect(projectStructure.output).toContain("src/");
    expect(projectStructure.output).toContain("nested/");
    expect(projectStructure.output).not.toContain("deeper/");

    expect(directoryListing.success).toBe(true);
    expect(directoryListing.data).toMatchObject({ count: 2 });
    expect(directoryListing.output.split("\n")).toHaveLength(2);
  });

  test("WorkspaceEdit tolerates string boolean and numeric fields for edits", async () => {
    const projectDir = createTempProject("pebble-tools-workspace-edit-coercion-");
    writeFileSync(join(projectDir, "notes.txt"), "alpha\nbeta\n", "utf-8");

    const tool = new WorkspaceEditTool();
    const createResult = await tool.execute(
      {
        action: "write_file",
        file_path: "nested/generated.txt",
        content: "hello\n",
        create_directories: "true",
      },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    const editResult = await tool.execute(
      {
        action: "edit_file",
        file_path: "notes.txt",
        old_string: "beta",
        new_string: "gamma",
        expected_replacements: "1",
      },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    const overwriteResult = await tool.execute(
      {
        action: "write_file",
        file_path: "nested/generated.txt",
        content: "updated\n",
        overwrite: "true",
      },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(createResult.success).toBe(true);
    expect(editResult.success).toBe(true);
    expect(overwriteResult.success).toBe(true);
    expect(readFileSync(join(projectDir, "notes.txt"), "utf-8")).toBe("alpha\ngamma\n");
    expect(readFileSync(join(projectDir, "nested/generated.txt"), "utf-8")).toBe("updated\n");
  });

  test("QueryEngine executes WorkspaceEdit write_file calls with string booleans without unnecessary approval", async () => {
    const projectDir = createTempProject("pebble-tools-workspace-edit-engine-");
    const permissionManager = new PermissionManager({
      mode: "always-ask",
      projectRoot: projectDir,
    });
    const approvalRequests: string[] = [];

    const provider = new ScriptedProvider((messages, callNumber) => {
      if (callNumber === 1) {
        return {
          text: "Creating the file.",
          toolCalls: [
            {
              id: "write-1",
              name: "WorkspaceEdit",
              input: {
                action: "write_file",
                file_path: "test.md",
                content: "Hello World\n",
                overwrite: "false",
              },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 4, outputTokens: 3 },
        };
      }

      expect(messages.at(-1)).toMatchObject({
        role: "tool",
        toolName: "WorkspaceEdit",
        metadata: {
          success: true,
          input: {
            action: "write_file",
            file_path: "test.md",
            content: "Hello World\n",
            overwrite: "false",
          },
        },
      });

      return {
        text: "Done.",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 3, outputTokens: 1 },
      };
    });

    const engine = new QueryEngine({
      provider,
      tools: [new WorkspaceEditTool()],
      cwd: projectDir,
      permissionManager,
      resolvePermission: async (request) => {
        approvalRequests.push(request.approvalMessage);
        return "allow";
      },
    });

    const result = await engine.process([{ role: "user", content: "Create test.md with Hello World" }]);

    expect(result.success).toBe(true);
    expect(approvalRequests).toEqual([]);
    expect(readFileSync(join(projectDir, "test.md"), "utf-8")).toBe("Hello World\n");
  });

  test("MemoryTool can manage session memory and notes", async () => {
    const projectDir = createTempProject("pebble-tools-memory-");
    const sessionStore = createProjectSessionStore(projectDir);
    const session = sessionStore.createSession("memory-session");
    sessionStore.appendMessage(session.id, {
      role: "user",
      content: "Remember this context",
      timestamp: new Date().toISOString(),
    });

    const tool = new MemoryTool();
    const memoryResult = await tool.execute(
      { action: "session_memory_show", refresh: true },
      {
        cwd: projectDir,
        permissionMode: "always-ask",
        runtime: { sessionId: session.id, sessionStore },
      },
    );
    expect(memoryResult.success).toBe(true);
    expect(memoryResult.output).toContain("Session memory: memory-session");

    const noteResult = await tool.execute(
      { action: "note_add", title: "Decision", content: "Use capability tools." },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    expect(noteResult.success).toBe(true);

    const listNotes = await tool.execute(
      { action: "note_list" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    expect(listNotes.output).toContain("Use capability tools.");
  });

  test("NotebookTool can create, edit, run, and read a notebook cell", async () => {
    const projectDir = createTempProject("pebble-tools-notebook-");
    const tool = new NotebookTool();

    const createResult = await tool.execute(
      { action: "create_notebook", file_path: "demo.ipynb", language: "javascript" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    expect(createResult.success).toBe(true);

    const editResult = await tool.execute(
      {
        action: "edit_cell",
        file_path: "demo.ipynb",
        edit_mode: "insert",
        index: 0,
        cell_type: "code",
        source: 'console.log("hello notebook")\n',
      },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    expect(editResult.success).toBe(true);

    const runResult = await tool.execute(
      { action: "run_cell", file_path: "demo.ipynb", index: 0, language: "javascript" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    expect(runResult.success).toBe(true);
    expect(runResult.output).toContain("hello notebook");

    const readOutput = await tool.execute(
      { action: "read_output", file_path: "demo.ipynb", index: 0 },
      { cwd: projectDir, permissionMode: "always-ask" },
    );
    expect(readOutput.output).toContain("hello notebook");
  });

  test("WebTool can fetch a data URL without network dependency", async () => {
    const tool = new WebTool();
    const result = await tool.execute(
      { action: "fetch_url", url: "data:text/plain,Hello%20Pebble" },
      { cwd: process.cwd(), permissionMode: "always-ask" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Hello Pebble");
  });

  test("ShellTool can execute synchronous commands", async () => {
    const projectDir = createTempProject("pebble-tools-shell-");
    const tool = new ShellTool();
    const result = await tool.execute(
      { action: "exec", command: "printf 'hello shell'" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("hello shell");
  });

  test("ShellTool compacts git status output for common repo inspection", async () => {
    const projectDir = createTempProject("pebble-tools-shell-git-status-");
    Bun.spawnSync({ cmd: ["git", "init", "-q"], cwd: projectDir, stdout: "pipe", stderr: "pipe" });
    writeFileSync(join(projectDir, "demo.txt"), "demo\n", "utf-8");

    const tool = new ShellTool();
    const result = await tool.execute(
      { action: "exec", command: "git status --short" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Git status");
    expect(result.output).toContain("Files changed: 2");
    expect(result.output).toContain("?? demo.txt");
    expect(result.truncated).toBe(true);
  });

  test("ShellTool preserves full failing test output in a sidecar log when compacting", async () => {
    const projectDir = createTempProject("pebble-tools-shell-test-log-");
    writeFileSync(
      join(projectDir, "failing.test.ts"),
      [
        'import { expect, test } from "bun:test";',
        'test("fails loudly", () => {',
        '  expect(1).toBe(2);',
        '});',
        "",
      ].join("\n"),
      "utf-8",
    );

    const tool = new ShellTool();
    const result = await tool.execute(
      { action: "exec", command: "bun test" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(result.success).toBe(false);
    expect(result.summary?.toLowerCase()).toContain("fail");
    expect(result.output).toContain("Full output saved to");

    const logPath = result.output.match(/Full output saved to (.+?)\]/)?.[1];
    expect(logPath).toBeTruthy();
    expect(existsSync(logPath!)).toBe(true);
    expect(readFileSync(logPath!, "utf-8")).toContain("Expected: 2");
  });

  test("WorkspaceRead groups grep matches by file", async () => {
    const projectDir = createTempProject("pebble-tools-workspace-grep-");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", "one.ts"), "const target = 1;\nconsole.log(target);\n", "utf-8");
    writeFileSync(join(projectDir, "src", "two.ts"), "export const target = 2;\n", "utf-8");

    const tool = new WorkspaceReadTool();
    const result = await tool.execute(
      { action: "grep", pattern: "target", path: "src", max_results: 10 },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("matches across 2 files");
    expect(result.output).toContain("[file]");
    expect(result.output).toContain("one.ts");
    expect(result.output).toContain("two.ts");
    expect(result.output).toContain("1: const target = 1;");
  });

  test("WorkspaceRead applies smart source compaction to large code files", async () => {
    const projectDir = createTempProject("pebble-tools-workspace-read-compact-");
    const largeSource = [
      "import { join } from \"node:path\";",
      "",
      ...Array.from({ length: 500 }, (_, index) => `// comment ${index}`),
      "export function importantFunction() {",
      "  return join('a', 'b');",
      "}",
      "",
      "export class ExampleClass {",
      "  value = 1;",
      "}",
    ].join("\n");
    writeFileSync(join(projectDir, "large.ts"), largeSource, "utf-8");

    const tool = new WorkspaceReadTool();
    const result = await tool.execute(
      { action: "read_file", file_path: "large.ts" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("source compaction");
    expect(result.output).toContain("importantFunction");
    expect(result.output).toContain("ExampleClass");
    expect(result.output).not.toContain("// comment 42");
  });

  test("IntegrationTool can discover local skills", async () => {
    const projectDir = createTempProject("pebble-tools-integration-");
    const skillDir = join(projectDir, "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Demo skill\n", "utf-8");

    const tool = new IntegrationTool();
    const result = await tool.execute(
      { action: "list_skills", path: projectDir },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("SKILL.md");
  });

  test("OrchestrateTool can load planning file status", async () => {
    const projectDir = createTempProject("pebble-tools-orchestrate-");
    writeFileSync(join(projectDir, "task_plan.md"), "- [x] done\n", "utf-8");
    writeFileSync(join(projectDir, "findings.md"), "finding\n", "utf-8");
    writeFileSync(join(projectDir, "progress.md"), "progress\n", "utf-8");

    const tool = new OrchestrateTool();
    const result = await tool.execute(
      { action: "plan_status" },
      { cwd: projectDir, permissionMode: "always-ask" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("task_plan.md");
    expect(result.output).toContain("- [x] done");
  });
});

describe("persisted approvals", () => {
  test("pending approvals are failed and appended to the transcript on resume", () => {
    const projectDir = createTempProject("pebble-tools-approvals-");
    const permissionManager = new PermissionManager({
      mode: "always-ask",
      projectRoot: projectDir,
    });
    const sessionStore = createProjectSessionStore(projectDir);
    const session = sessionStore.createSession("approval-session");

    permissionManager.createPendingApproval({
      sessionId: session.id,
      toolCallId: "call-1",
      toolName: "WorkspaceEdit",
      toolArgs: { file_path: "package.json" },
      approvalMessage: "Allow editing package.json?",
    });

    const failed = failPendingApprovalsForResume(sessionStore, permissionManager, session.id);
    expect(failed).toHaveLength(1);
    expect(sessionStore.loadTranscript(session.id)?.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "Tool execution denied: Pending approval expired when the session was resumed.",
      toolCall: {
        name: "WorkspaceEdit",
      },
    });
  });
});