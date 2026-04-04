import type { TranscriptMessage } from "./sessionStore";

/**
 * Token budget tracking for sessions.
 */
export interface TokenBudget {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

/**
 * Compaction boundary - where to truncate/summarize.
 */
export interface CompactionBoundary {
  /** Keep the last N messages intact */
  keepRecent: number;
  /** Summarize messages before the boundary */
  summarizeBefore: number;
  /** Always keep system messages */
  preserveSystem: boolean;
}

const DEFAULT_BOUNDARY: CompactionBoundary = {
  keepRecent: 20,
  summarizeBefore: 10,
  preserveSystem: true,
};

/**
 * Compact a transcript to fit within token limits.
 * Returns the compacted message list.
 */
export function compactTranscript(
  messages: TranscriptMessage[],
  boundary: CompactionBoundary = DEFAULT_BOUNDARY,
): TranscriptMessage[] {
  if (messages.length <= boundary.keepRecent) {
    return messages;
  }

  // Preserve system messages
  const systemMessages = boundary.preserveSystem
    ? messages.filter((m) => m.role === "system")
    : [];

  // Keep recent messages intact
  const recentMessages = messages.slice(-boundary.keepRecent);

  // Summarize older messages (stub - would call LLM to summarize)
  const olderMessages = messages.slice(
    systemMessages.length,
    messages.length - boundary.keepRecent,
  );

  const summary: TranscriptMessage = {
    role: "system",
    content: `[Summary of ${olderMessages.length} previous messages]`,
    timestamp: new Date().toISOString(),
  };

  return [...systemMessages, summary, ...recentMessages];
}

/**
 * Estimate token count for a message list.
 * Rough approximation: ~4 chars per token.
 */
export function estimateTokens(messages: TranscriptMessage[]): number {
  return Math.ceil(
    messages.reduce((sum, m) => sum + m.content.length, 0) / 4,
  );
}

/**
 * Track token usage and cost.
 */
export class TokenTracker {
  private budget: TokenBudget = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
  };
  private costPerInputToken: number;
  private costPerOutputToken: number;

  constructor(options: {
    costPerInputToken?: number;
    costPerOutputToken?: number;
  } = {}) {
    this.costPerInputToken = options.costPerInputToken ?? 0.000005;
    this.costPerOutputToken = options.costPerOutputToken ?? 0.000015;
  }

  /**
   * Record token usage for a turn.
   */
  recordUsage(inputTokens: number, outputTokens: number): void {
    this.budget.inputTokens += inputTokens;
    this.budget.outputTokens += outputTokens;
    this.budget.totalTokens = this.budget.inputTokens + this.budget.outputTokens;
    this.budget.estimatedCost =
      this.budget.inputTokens * this.costPerInputToken +
      this.budget.outputTokens * this.costPerOutputToken;
  }

  /**
   * Get current budget summary.
   */
  getBudget(): TokenBudget {
    return { ...this.budget };
  }

  /**
   * Reset the tracker.
   */
  reset(): void {
    this.budget = {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    };
  }
}
