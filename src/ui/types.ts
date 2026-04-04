/**
 * Metadata attached to display messages for richer rendering.
 */
export interface DisplayMeta {
  /** Tool name for tool_call / tool_result messages */
  toolName?: string;
  /** Key arguments for a tool call (truncated for display) */
  toolArgs?: Record<string, unknown>;
  /** Tool output/body rendered beneath the headline when available */
  toolOutput?: string;
  /** Approval message produced by the tool before execution */
  approvalMessage?: string;
  /** Whether this message represents an error */
  isError?: boolean;
  /** Optional machine-friendly error message/details */
  errorMessage?: string;
  /** Turn number within the engine loop */
  turnNumber?: number;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether tool output shown to the user was truncated */
  truncated?: boolean;
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

export interface PendingQuestion {
  question: string;
  options: string[];
  allowFreeform: boolean;
  resolve: (answer: string) => void;
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
  /** Non-null when the engine is blocked waiting for an AskUserQuestion response */
  pendingQuestion: PendingQuestion | null;
}

export const VISIBLE_MESSAGE_COUNT = 20;
