import type { SessionStore, SessionTranscript } from "../../persistence/sessionStore.js";
import type { TelegramBinding } from "./types.js";
import { TelegramStateStore } from "./state.js";

interface TelegramMetadataRecord {
  bindingKey: string;
  chatId: string;
  userId?: string;
  threadId?: string;
  chatType: string;
  lastInboundUpdateId?: number;
  lastOutboundMessageId?: number;
  pendingApprovalToken?: string | null;
}

export interface TelegramSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  isActive: boolean;
}

export function buildTelegramBindingKey(chatId: string | number, threadId?: string | number): string {
  const chatKey = `tg:chat:${String(chatId)}`;
  return threadId === undefined || threadId === null || String(threadId).trim() === ""
    ? chatKey
    : `${chatKey}:thread:${String(threadId)}`;
}

export function listTelegramSessionsForBinding(
  store: SessionStore,
  state: TelegramStateStore,
  bindingKey: string,
): TelegramSessionSummary[] {
  const activeSessionId = state.getBinding(bindingKey)?.sessionId;

  return store.listSessions()
    .flatMap((summary) => {
      const transcript = store.loadTranscript(summary.id);
      const telegram = getTelegramMetadata(transcript);
      if (!transcript || !telegram || telegram.bindingKey !== bindingKey) {
        return [];
      }

      return [{
        id: transcript.id,
        title: deriveTelegramSessionTitle(transcript),
        updatedAt: transcript.updatedAt,
        isActive: transcript.id === activeSessionId,
      } satisfies TelegramSessionSummary];
    });
}

export function getOrCreateTelegramSession(
  store: SessionStore,
  state: TelegramStateStore,
  binding: TelegramBinding,
  updateId?: number,
): SessionTranscript {
  const boundSessionId = state.getBinding(binding.bindingKey)?.sessionId;
  if (boundSessionId) {
    const transcript = store.loadTranscript(boundSessionId);
    if (transcript) {
      return updateTelegramSessionMetadata(store, transcript.id, binding, {
        ...(typeof updateId === "number" ? { lastInboundUpdateId: updateId } : {}),
      });
    }
  }

  return createTelegramSession(store, state, binding, updateId);
}

export function createTelegramSession(
  store: SessionStore,
  state: TelegramStateStore,
  binding: TelegramBinding,
  updateId?: number,
): SessionTranscript {
  const transcript = store.createSession();
  state.setBinding(binding.bindingKey, transcript.id);
  return updateTelegramSessionMetadata(store, transcript.id, binding, {
    ...(typeof updateId === "number" ? { lastInboundUpdateId: updateId } : {}),
  });
}

export function bindTelegramSession(
  store: SessionStore,
  state: TelegramStateStore,
  binding: TelegramBinding,
  sessionId: string,
): SessionTranscript | null {
  const transcript = store.loadTranscript(sessionId);
  if (!transcript) {
    return null;
  }

  state.setBinding(binding.bindingKey, sessionId);
  return updateTelegramSessionMetadata(store, sessionId, binding);
}

export function updateTelegramSessionMetadata(
  store: SessionStore,
  sessionId: string,
  binding: TelegramBinding,
  patch: Partial<Omit<TelegramMetadataRecord, "bindingKey" | "chatId" | "userId" | "threadId" | "chatType">> = {},
): SessionTranscript {
  const transcript = store.loadTranscript(sessionId);
  const current = getTelegramMetadata(transcript);

  return store.updateMetadata(sessionId, {
    telegram: {
      ...(current ?? {}),
      bindingKey: binding.bindingKey,
      chatId: binding.chatId,
      ...(binding.userId ? { userId: binding.userId } : {}),
      ...(binding.threadId ? { threadId: binding.threadId } : {}),
      chatType: binding.chatType,
      ...patch,
    },
  });
}

export function clearTelegramPendingApprovalToken(
  store: SessionStore,
  sessionId: string,
  binding: TelegramBinding,
): SessionTranscript {
  return updateTelegramSessionMetadata(store, sessionId, binding, {
    pendingApprovalToken: null,
  });
}

export function setTelegramPendingApprovalToken(
  store: SessionStore,
  sessionId: string,
  binding: TelegramBinding,
  token: string,
): SessionTranscript {
  return updateTelegramSessionMetadata(store, sessionId, binding, {
    pendingApprovalToken: token,
  });
}

function getTelegramMetadata(transcript: SessionTranscript | null | undefined): TelegramMetadataRecord | null {
  const telegram = transcript?.metadata?.telegram;
  if (!telegram || typeof telegram !== "object" || Array.isArray(telegram)) {
    return null;
  }

  const value = telegram as Record<string, unknown>;
  if (typeof value.bindingKey !== "string" || typeof value.chatId !== "string" || typeof value.chatType !== "string") {
    return null;
  }

  return {
    bindingKey: value.bindingKey,
    chatId: value.chatId,
    userId: typeof value.userId === "string" ? value.userId : undefined,
    threadId: typeof value.threadId === "string" ? value.threadId : undefined,
    chatType: value.chatType,
    lastInboundUpdateId: typeof value.lastInboundUpdateId === "number" ? value.lastInboundUpdateId : undefined,
    lastOutboundMessageId: typeof value.lastOutboundMessageId === "number" ? value.lastOutboundMessageId : undefined,
    pendingApprovalToken: typeof value.pendingApprovalToken === "string" || value.pendingApprovalToken === null
      ? value.pendingApprovalToken
      : undefined,
  };
}

function deriveTelegramSessionTitle(transcript: SessionTranscript): string {
  const latestUserMessage = [...transcript.messages]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim().length > 0);
  const source = latestUserMessage?.content.trim() || transcript.messages[0]?.content.trim() || transcript.id;
  return source.length > 60 ? `${source.slice(0, 57)}…` : source;
}
