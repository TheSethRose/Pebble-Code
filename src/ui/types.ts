export interface DisplayMessage {
  role: string;
  content: string;
}

export interface AppState {
  messages: DisplayMessage[];
  isProcessing: boolean;
  statusText: string;
  error: string | null;
  activeSessionId: string | null;
}

export const VISIBLE_MESSAGE_COUNT = 20;
