import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSettingsForCwd } from "../src/runtime/config";
import { resolveTelegramRuntimeConfig } from "../src/runtime/telegram";
import {
  buildApprovalCallbackData,
  parseApprovalCallbackData,
  TelegramApprovalCoordinator,
} from "../src/runtime/telegram/approvals";
import { normalizeTelegramCommandText } from "../src/runtime/telegram/commands";
import { chunkTelegramText, TelegramDelivery, getTelegramRetryAfterMs } from "../src/runtime/telegram/delivery";
import { createTelegramLogger, getTelegramLogPath } from "../src/runtime/telegram/logger";
import { pollTelegramUpdatesOnce } from "../src/runtime/telegram/monitor";
import {
  buildTelegramBindingKey,
  createTelegramSession,
  getOrCreateTelegramSession,
  listTelegramSessionsForBinding,
} from "../src/runtime/telegram/sessions";
import { TelegramStateStore } from "../src/runtime/telegram/state";
import { createProjectSessionStore } from "../src/persistence/runtimeSessions";
import { PermissionManager } from "../src/runtime/permissionManager";

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

describe("telegram runtime helpers", () => {
  test("resolveTelegramRuntimeConfig merges runtime overrides with workspace settings", () => {
    const projectDir = createTempProject("pebble-telegram-config-");
    const settings = loadSettingsForCwd(projectDir);

    const resolved = resolveTelegramRuntimeConfig({
      ...settings,
      telegram: {
        ...settings.telegram,
        botToken: "settings-token",
        allowedUserIds: ["111"],
        allowedChatIds: ["222"],
      },
    }, {
      botToken: "override-token",
      botId: "999",
      mode: "webhook",
      allowedUserIds: ["333"],
      webhookUrl: "https://example.test/telegram",
    });

    expect(resolved.botToken).toBe("override-token");
    expect(resolved.botId).toBe("999");
    expect(resolved.mode).toBe("webhook");
    expect(resolved.allowedUserIds).toEqual(["333"]);
    expect(resolved.allowedChatIds).toEqual(["222"]);
    expect(resolved.webhookUrl).toBe("https://example.test/telegram");
    expect(resolved.streamEdits).toBe(true);
  });

  test("chunkTelegramText keeps chunks under the configured ceiling", () => {
    const chunks = chunkTelegramText("alpha beta gamma delta epsilon zeta eta theta", 12);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toContain("alpha beta gamma");
  });

  test("normalizeTelegramCommandText strips matching bot mentions and ignores other bots", () => {
    expect(normalizeTelegramCommandText("/help@PebbleBot please", "PebbleBot")).toBe("/help please");
    expect(normalizeTelegramCommandText("/help@OtherBot please", "PebbleBot")).toBeNull();
    expect(normalizeTelegramCommandText("hello there", "PebbleBot")).toBe("hello there");
  });

  test("pollTelegramUpdatesOnce replays updates and persists the latest offset", async () => {
    const projectDir = createTempProject("pebble-telegram-poll-");
    const state = new TelegramStateStore(projectDir);
    const seenOffsets: Array<number | undefined> = [];
    const handledUpdates: number[] = [];

    const bot = {
      api: {
        getUpdates: async (args: { offset?: number }) => {
          seenOffsets.push(args.offset);
          return [
            { update_id: 14, message: { text: "hello" } },
            { update_id: 15, callback_query: { data: "approve" } },
          ];
        },
      },
      handleUpdate: async (update: { update_id: number }) => {
        handledUpdates.push(update.update_id);
      },
    };

    const highest = await pollTelegramUpdatesOnce({
      bot: bot as never,
      state,
      pollingTimeoutSeconds: 20,
      persistOffsets: true,
    });

    expect(seenOffsets).toEqual([undefined]);
    expect(handledUpdates).toEqual([14, 15]);
    expect(highest).toBe(15);
    expect(state.getLastUpdateId()).toBe(15);
  });

  test("createTelegramLogger writes structured lines to the Pebble home log file", () => {
    const pebbleHomeDir = createTempProject("pebble-telegram-log-home-");
    const logger = createTelegramLogger(pebbleHomeDir);

    logger.info("Telegram runtime booting", { mode: "polling" });
    logger.error("Telegram polling error", { error: "boom" });

    const logContents = readFileSync(getTelegramLogPath(pebbleHomeDir), "utf-8");
    expect(logContents).toContain("INFO Telegram runtime booting");
    expect(logContents).toContain('"mode":"polling"');
    expect(logContents).toContain("ERROR Telegram polling error");
    expect(logContents).toContain('"error":"boom"');
  });

  test("telegram session helpers bind chats and reuse the active session", () => {
    const projectDir = createTempProject("pebble-telegram-sessions-");
    const sessionStore = createProjectSessionStore(projectDir);
    const state = new TelegramStateStore(projectDir);
    const binding = {
      bindingKey: buildTelegramBindingKey("12345", "7"),
      chatId: "12345",
      userId: "999",
      threadId: "7",
      chatType: "supergroup",
    };

    const created = createTelegramSession(sessionStore, state, binding, 41);
    const reused = getOrCreateTelegramSession(sessionStore, state, binding, 42);
    const listed = listTelegramSessionsForBinding(sessionStore, state, binding.bindingKey);

    expect(reused.id).toBe(created.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: created.id, isActive: true });
    expect(sessionStore.loadTranscript(created.id)?.metadata).toMatchObject({
      telegram: expect.objectContaining({
        bindingKey: binding.bindingKey,
        chatId: "12345",
        threadId: "7",
        lastInboundUpdateId: 42,
      }),
    });
  });

  test("telegram topic bindings stay isolated within the same supergroup", () => {
    const projectDir = createTempProject("pebble-telegram-topics-");
    const sessionStore = createProjectSessionStore(projectDir);
    const state = new TelegramStateStore(projectDir);
    const topicOne = {
      bindingKey: buildTelegramBindingKey("555", "1"),
      chatId: "555",
      threadId: "1",
      chatType: "supergroup",
    };
    const topicTwo = {
      bindingKey: buildTelegramBindingKey("555", "2"),
      chatId: "555",
      threadId: "2",
      chatType: "supergroup",
    };

    const first = createTelegramSession(sessionStore, state, topicOne);
    const second = createTelegramSession(sessionStore, state, topicTwo);

    expect(first.id).not.toBe(second.id);
    expect(listTelegramSessionsForBinding(sessionStore, state, topicOne.bindingKey)).toHaveLength(1);
    expect(listTelegramSessionsForBinding(sessionStore, state, topicTwo.bindingKey)).toHaveLength(1);
  });

  test("approval callback helpers round-trip short Telegram-safe payloads", () => {
    const approve = buildApprovalCallbackData("token123", "approve");
    const deny = buildApprovalCallbackData("token123", "deny");

    expect(approve.length).toBeLessThanOrEqual(64);
    expect(deny.length).toBeLessThanOrEqual(64);
    expect(parseApprovalCallbackData(approve)).toEqual({ token: "token123", decision: "approve" });
    expect(parseApprovalCallbackData(deny)).toEqual({ token: "token123", decision: "deny" });
  });

  test("approval coordinator can resolve persisted approval state after a restart", () => {
    const projectDir = createTempProject("pebble-telegram-approval-recovery-");
    const state = new TelegramStateStore(projectDir);
    const permissionManager = new PermissionManager({
      mode: "always-ask",
      projectRoot: projectDir,
    });
    const coordinator = new TelegramApprovalCoordinator(state, permissionManager);
    const approval = state.createApproval({
      sessionId: "session-1",
      bindingKey: buildTelegramBindingKey("1"),
      toolName: "ApplyPatch",
      approvalMessage: "Approve patch?",
    });

    const resolved = coordinator.resolveApproval(approval.token, "deny");

    expect(resolved.resumedLiveFlow).toBe(false);
    expect(resolved.record).toMatchObject({
      token: approval.token,
      status: "resolved",
      resolution: "deny",
    });
  });

  test("TelegramDelivery retries rate-limited sendMessage calls", async () => {
    const attempts: number[] = [];
    const delivery = new TelegramDelivery({
      api: {
        sendMessage: async () => {
          attempts.push(Date.now());
          if (attempts.length === 1) {
            throw { parameters: { retry_after: 0 } };
          }

          return { message_id: 77 };
        },
      },
    } as never, {
      botToken: "token",
      mode: "polling",
      allowedUserIds: [],
      allowedChatIds: [],
      handleGroupMentionsOnly: true,
      streamEdits: true,
      editDebounceMs: 10,
      maxMessageChars: 4096,
      syncCommandsOnStart: true,
      persistOffsets: true,
      pollingTimeoutSeconds: 20,
      webhookPath: "/telegram/webhook",
      webhookHost: "127.0.0.1",
      webhookPort: 8788,
    });

    const messageId = await delivery.sendText({
      chatId: 1,
      binding: {
        bindingKey: buildTelegramBindingKey("1"),
        chatId: "1",
        chatType: "private",
      },
    }, "hello telegram");

    expect(messageId).toBe(77);
    expect(attempts).toHaveLength(2);
    expect(getTelegramRetryAfterMs({ parameters: { retry_after: 2 } })).toBe(2000);
  });

  test("TelegramLiveReply finalize ignores Telegram's message-not-modified edit errors", async () => {
    const delivery = new TelegramDelivery({
      api: {
        sendMessage: async () => ({ message_id: 12 }),
        editMessageText: async () => {
          throw new Error("Call to 'editMessageText' failed! (400: Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message)");
        },
      },
    } as never, {
      botToken: "token",
      mode: "polling",
      allowedUserIds: [],
      allowedChatIds: [],
      handleGroupMentionsOnly: true,
      streamEdits: true,
      editDebounceMs: 10,
      maxMessageChars: 4096,
      syncCommandsOnStart: true,
      persistOffsets: true,
      pollingTimeoutSeconds: 20,
      webhookPath: "/telegram/webhook",
      webhookHost: "127.0.0.1",
      webhookPort: 8788,
    });

    const liveReply = delivery.createLiveReply({
      chatId: 1,
      binding: {
        bindingKey: buildTelegramBindingKey("1"),
        chatId: "1",
        chatType: "private",
      },
    });

    await liveReply.start();
    const messageId = await liveReply.finalize("Thinking…");

    expect(messageId).toBe(12);
  });
});
