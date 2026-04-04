/**
 * Metadata attached to display messages for richer rendering.
 */
export interface DisplayMeta {
  /** Tool name for tool_call / tool_result messages */
  toolName?: string;
  /** Key arguments for a tool call (truncated for display) */
  toolArgs?: Record<string, unknown>;
  /** Approval message produced by the tool before execution */
  approvalMessage?: string;
  /** Whether this message represents an error */
  isError?: boolean;
  /** Turn number within the engine loop */
  turnNumber?: number;
  /** Execution duration in milliseconds */
  durationMs?: number;
}

export interface DisplayMessage {
  role: string;
  content: string;
  /** Optional structured metadata for richer rendering */
  meta?: DisplayMeta;
}

/**
 * Pending permission request surfaced to the UI for interactive approval.
 */
export interface PendingPermission {
  toolName: string;
  toolArgs: Record<string, unknown>;
  approvalMessage: string;
  resolve: (decision: PermissionChoice) => void;
}

export type PermissionChoice =
  | "allow"
  | "deny"
  | "allow-session"
  | "allow-always";

export interface AppState {
  messages: DisplayMessage[];
  isProcessing: boolean;
  statusText: string;
  error: string | null;
  activeSessionId: string | null;
  /** Non-null when the engine is blocked waiting for a permission decision */
  pendingPermission: PendingPermission | null;
}

export const VISIBLE_MESSAGE_COUNT = 20;
