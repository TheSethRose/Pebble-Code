import { InlineKeyboard } from "grammy";
import type { PermissionDecision } from "../permissions.js";
import { PermissionManager } from "../permissionManager.js";
import { TelegramStateStore } from "./state.js";
import {
  TELEGRAM_APPROVE_CALLBACK_PREFIX,
  TELEGRAM_DENY_CALLBACK_PREFIX,
  type TelegramApprovalStateRecord,
  type TelegramBinding,
} from "./types.js";

interface LiveApproval {
  record: TelegramApprovalStateRecord;
  resolve: (decision: PermissionDecision) => void;
}

function stringifyArgs(value: Record<string, unknown>): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

export function buildApprovalCallbackData(token: string, decision: "approve" | "deny"): string {
  return `${decision === "approve" ? TELEGRAM_APPROVE_CALLBACK_PREFIX : TELEGRAM_DENY_CALLBACK_PREFIX}${token}`;
}

export function parseApprovalCallbackData(data: string | undefined): { token: string; decision: "approve" | "deny" } | null {
  if (!data) {
    return null;
  }

  if (data.startsWith(TELEGRAM_APPROVE_CALLBACK_PREFIX)) {
    return {
      token: data.slice(TELEGRAM_APPROVE_CALLBACK_PREFIX.length),
      decision: "approve",
    };
  }

  if (data.startsWith(TELEGRAM_DENY_CALLBACK_PREFIX)) {
    return {
      token: data.slice(TELEGRAM_DENY_CALLBACK_PREFIX.length),
      decision: "deny",
    };
  }

  return null;
}

export function buildApprovalKeyboard(token: string) {
  return new InlineKeyboard()
    .text("Approve", buildApprovalCallbackData(token, "approve"))
    .text("Deny", buildApprovalCallbackData(token, "deny"));
}

export class TelegramApprovalCoordinator {
  private readonly liveApprovals = new Map<string, LiveApproval>();

  constructor(
    private readonly state: TelegramStateStore,
    private readonly permissionManager: PermissionManager,
  ) {}

  async requestApproval(params: {
    sessionId: string;
    binding: TelegramBinding;
    toolName: string;
    toolArgs: Record<string, unknown>;
    approvalMessage: string;
  }): Promise<{ token: string; decision: PermissionDecision }> {
    const pendingApproval = this.permissionManager
      .getPendingApprovals(params.sessionId)
      .filter((approval) => approval.toolName === params.toolName)
      .filter((approval) => approval.approvalMessage === params.approvalMessage)
      .filter((approval) => stringifyArgs(approval.toolArgs) === stringifyArgs(params.toolArgs))
      .at(-1);

    const record = this.state.createApproval({
      permissionId: pendingApproval?.id,
      sessionId: params.sessionId,
      bindingKey: params.binding.bindingKey,
      toolName: params.toolName,
      approvalMessage: params.approvalMessage,
    });

    const decision = await new Promise<PermissionDecision>((resolve) => {
      this.liveApprovals.set(record.token, { record, resolve });
    });

    return { token: record.token, decision };
  }

  resolveApproval(token: string, decision: PermissionDecision): { record?: TelegramApprovalStateRecord; resumedLiveFlow: boolean } {
    const liveApproval = this.liveApprovals.get(token);
    const record = this.state.resolveApproval(token, decision, "resolved") ?? this.state.getApproval(token);

    if (record?.permissionId) {
      this.permissionManager.resolvePendingApproval(record.permissionId, decision);
    }

    if (!liveApproval) {
      return { record, resumedLiveFlow: false };
    }

    this.liveApprovals.delete(token);
    liveApproval.resolve(decision);
    return { record: liveApproval.record, resumedLiveFlow: true };
  }

  expireApproval(token: string, reason: string): TelegramApprovalStateRecord | undefined {
    const liveApproval = this.liveApprovals.get(token);
    if (liveApproval) {
      this.liveApprovals.delete(token);
      liveApproval.resolve("deny");
    }

    return this.state.resolveApproval(token, reason, "expired");
  }

  listPending(bindingKey?: string): TelegramApprovalStateRecord[] {
    return this.state.listPendingApprovals(bindingKey);
  }
}
