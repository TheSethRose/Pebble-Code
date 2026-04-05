import type { TranscriptMessage } from "./sessionStore";
import { buildMessageSummaryArtifact, type MessageSummaryArtifact } from "./summaryArtifacts.js";
import { estimateTokens } from "./tokenEstimation.js";

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

export const DEFAULT_BOUNDARY: CompactionBoundary = {
  keepRecent: 20,
  summarizeBefore: 10,
  preserveSystem: true,
};

export interface CompactionArtifact extends MessageSummaryArtifact {
  kind: "compaction-artifact";
  generatedAt: string;
  compactedMessageCount: number;
  preservedRecentCount: number;
}

export interface TranscriptCompactionResult {
  messages: TranscriptMessage[];
  compacted: boolean;
  artifact?: CompactionArtifact;
}

/**
 * Compact a transcript to fit within token limits.
 * Returns the compacted message list.
 */
export function compactTranscript(
  messages: TranscriptMessage[],
  boundary: CompactionBoundary = DEFAULT_BOUNDARY,
): TranscriptMessage[] {
  return compactTranscriptWithArtifact(messages, boundary).messages;
}

export function compactTranscriptWithArtifact(
  messages: TranscriptMessage[],
  boundary: CompactionBoundary = DEFAULT_BOUNDARY,
): TranscriptCompactionResult {
  if (messages.length <= boundary.keepRecent) {
    return {
      messages,
      compacted: false,
    };
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

  const artifact = buildCompactionArtifact(olderMessages, boundary.keepRecent);
  const summary: TranscriptMessage = {
    role: "system",
    content: formatCompactionArtifact(artifact),
    timestamp: artifact.generatedAt,
    metadata: artifact as unknown as Record<string, unknown>,
  };

  return {
    messages: [...systemMessages, summary, ...recentMessages],
    compacted: true,
    artifact,
  };
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

function buildCompactionArtifact(
  compactedMessages: TranscriptMessage[],
  preservedRecentCount: number,
): CompactionArtifact {
  const summaryArtifact = buildMessageSummaryArtifact(compactedMessages);
  return {
    kind: "compaction-artifact",
    generatedAt: new Date().toISOString(),
    compactedMessageCount: compactedMessages.length,
    preservedRecentCount,
    ...summaryArtifact,
  };
}

function formatCompactionArtifact(artifact: CompactionArtifact): string {
  return [
    "[Compacted transcript summary]",
    `Compacted earlier messages: ${artifact.compactedMessageCount}`,
    `Estimated tokens: ${artifact.tokenEstimate}`,
    "",
    "Summary:",
    artifact.summary,
    "",
    "Highlights:",
    ...artifact.bullets.map((bullet) => `- ${bullet}`),
  ].join("\n");
}

export { estimateTokens } from "./tokenEstimation.js";
