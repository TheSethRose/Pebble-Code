import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  TelegramApprovalStateRecord,
  TelegramBindingState,
  TelegramPersistedState,
} from "./types.js";

const DEFAULT_STATE: TelegramPersistedState = {
  lastUpdateId: null,
  bindings: {},
  approvals: {},
};

function normalizeState(input: unknown): TelegramPersistedState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_STATE };
  }

  const value = input as Record<string, unknown>;
  const lastUpdateId = typeof value.lastUpdateId === "number" && Number.isFinite(value.lastUpdateId)
    ? value.lastUpdateId
    : null;
  const bindings = value.bindings && typeof value.bindings === "object" && !Array.isArray(value.bindings)
    ? Object.fromEntries(
        Object.entries(value.bindings).flatMap(([bindingKey, binding]) => {
          if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
            return [];
          }

          const candidate = binding as Partial<TelegramBindingState>;
          if (typeof candidate.sessionId !== "string" || !candidate.sessionId.trim()) {
            return [];
          }

          return [[bindingKey, {
            sessionId: candidate.sessionId.trim(),
            updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
          }] as const];
        }),
      )
    : {};
  const approvals = value.approvals && typeof value.approvals === "object" && !Array.isArray(value.approvals)
    ? Object.fromEntries(
        Object.entries(value.approvals).flatMap(([token, approval]) => {
          if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
            return [];
          }

          const candidate = approval as Partial<TelegramApprovalStateRecord>;
          if (
            typeof candidate.sessionId !== "string"
            || typeof candidate.bindingKey !== "string"
            || typeof candidate.toolName !== "string"
            || typeof candidate.approvalMessage !== "string"
          ) {
            return [];
          }

          return [[token, {
            token,
            permissionId: typeof candidate.permissionId === "string" ? candidate.permissionId : undefined,
            sessionId: candidate.sessionId,
            bindingKey: candidate.bindingKey,
            toolName: candidate.toolName,
            approvalMessage: candidate.approvalMessage,
            createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
            status: candidate.status === "resolved" || candidate.status === "expired" ? candidate.status : "pending",
            resolution: typeof candidate.resolution === "string" ? candidate.resolution : undefined,
            resolvedAt: typeof candidate.resolvedAt === "string" ? candidate.resolvedAt : undefined,
          }] as const];
        }),
      )
    : {};

  return {
    lastUpdateId,
    bindings,
    approvals,
  };
}

function createToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class TelegramStateStore {
  private readonly filePath: string;
  private state: TelegramPersistedState;

  constructor(projectRoot: string) {
    this.filePath = join(projectRoot, ".pebble", "telegram-state.json");
    this.state = this.load();
  }

  getLastUpdateId(): number | null {
    return this.state.lastUpdateId;
  }

  setLastUpdateId(updateId: number | null): void {
    this.state.lastUpdateId = typeof updateId === "number" && Number.isFinite(updateId)
      ? updateId
      : null;
    this.save();
  }

  getBinding(bindingKey: string): TelegramBindingState | undefined {
    return this.state.bindings[bindingKey];
  }

  setBinding(bindingKey: string, sessionId: string): TelegramBindingState {
    const binding: TelegramBindingState = {
      sessionId,
      updatedAt: new Date().toISOString(),
    };
    this.state.bindings[bindingKey] = binding;
    this.save();
    return binding;
  }

  clearBinding(bindingKey: string): void {
    delete this.state.bindings[bindingKey];
    this.save();
  }

  createApproval(record: Omit<TelegramApprovalStateRecord, "token" | "createdAt" | "status">): TelegramApprovalStateRecord {
    const approval: TelegramApprovalStateRecord = {
      ...record,
      token: createToken(),
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    this.state.approvals[approval.token] = approval;
    this.save();
    return approval;
  }

  getApproval(token: string): TelegramApprovalStateRecord | undefined {
    return this.state.approvals[token];
  }

  resolveApproval(token: string, resolution: string, status: "resolved" | "expired" = "resolved"): TelegramApprovalStateRecord | undefined {
    const approval = this.state.approvals[token];
    if (!approval) {
      return undefined;
    }

    approval.status = status;
    approval.resolution = resolution;
    approval.resolvedAt = new Date().toISOString();
    this.save();
    return approval;
  }

  listPendingApprovals(bindingKey?: string): TelegramApprovalStateRecord[] {
    return Object.values(this.state.approvals)
      .filter((approval) => approval.status === "pending")
      .filter((approval) => !bindingKey || approval.bindingKey === bindingKey)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  snapshot(): TelegramPersistedState {
    return JSON.parse(JSON.stringify(this.state)) as TelegramPersistedState;
  }

  private load(): TelegramPersistedState {
    if (!existsSync(this.filePath)) {
      return { ...DEFAULT_STATE };
    }

    try {
      return normalizeState(JSON.parse(readFileSync(this.filePath, "utf-8")));
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
  }
}
