import type { Bot, Context } from "grammy";
import type { TelegramRunMode, TelegramSettings } from "../config.js";

export const TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query"] as const;
export const TELEGRAM_APPROVE_CALLBACK_PREFIX = "tgap:";
export const TELEGRAM_DENY_CALLBACK_PREFIX = "tgdn:";
export const TELEGRAM_DEFAULT_PLACEHOLDER = "Thinking…";
export const TELEGRAM_BUSY_MESSAGE = "Pebble is already working on this chat/topic. Use /stop to cancel the current run first.";

export interface TelegramRuntimeOverrides {
  cwd?: string;
  signal?: AbortSignal;
  botToken?: string;
  botId?: string;
  botUsername?: string;
  mode?: TelegramRunMode;
  allowedUserIds?: string[];
  allowedChatIds?: string[];
  webhookUrl?: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  webhookSecret?: string;
}

export interface ResolvedTelegramRuntimeConfig extends TelegramSettings {
  botToken: string;
  mode: TelegramRunMode;
  allowedUserIds: string[];
  allowedChatIds: string[];
  handleGroupMentionsOnly: boolean;
  streamEdits: boolean;
  editDebounceMs: number;
  maxMessageChars: number;
  syncCommandsOnStart: boolean;
  persistOffsets: boolean;
  pollingTimeoutSeconds: number;
  webhookPath: string;
  webhookHost: string;
  webhookPort: number;
}

export interface TelegramBotIdentity {
  id: string;
  username?: string;
}

export interface TelegramBinding {
  bindingKey: string;
  chatId: string;
  userId?: string;
  threadId?: string;
  chatType: string;
}

export interface TelegramBindingState {
  sessionId: string;
  updatedAt: string;
}

export interface TelegramApprovalStateRecord {
  token: string;
  permissionId?: string;
  sessionId: string;
  bindingKey: string;
  toolName: string;
  approvalMessage: string;
  createdAt: string;
  status: "pending" | "resolved" | "expired";
  resolution?: string;
  resolvedAt?: string;
}

export interface TelegramPersistedState {
  lastUpdateId: number | null;
  bindings: Record<string, TelegramBindingState>;
  approvals: Record<string, TelegramApprovalStateRecord>;
}

export type TelegramContext = Context;
export type TelegramBot = Bot<TelegramContext>;

export interface TelegramPromptScope {
  chatId: number;
  threadId?: number;
  binding: TelegramBinding;
}

export interface TelegramPendingQuestion {
  bindingKey: string;
  question: string;
  options: string[];
  allowFreeform: boolean;
  resolve: (answer: string) => void;
}

export interface TelegramSyncCommand {
  command: string;
  description: string;
}
