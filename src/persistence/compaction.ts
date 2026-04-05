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
  instructions?: string;
  providerMarker?: ProviderCompactionMarker;
}

export interface ProviderCompactionMarker {
  kind: "local-context-management";
  appliedAt: string;
  providerId?: string;
  model?: string;
  compactThreshold?: number;
  compactPrepareThreshold?: number;
  instructionsApplied: boolean;
}

export interface TranscriptCompactionOptions {
  instructions?: string;
  providerMarker?: ProviderCompactionMarker;
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
  options: TranscriptCompactionOptions = {},
): TranscriptMessage[] {
  return compactTranscriptWithArtifact(messages, boundary, options).messages;
}

export function compactTranscriptWithArtifact(
  messages: TranscriptMessage[],
  boundary: CompactionBoundary = DEFAULT_BOUNDARY,
  options: TranscriptCompactionOptions = {},
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

  const artifact = buildCompactionArtifact(olderMessages, boundary.keepRecent, options);
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
  options: TranscriptCompactionOptions,
): CompactionArtifact {
  const summaryArtifact = buildMessageSummaryArtifact(compactedMessages);
  const instructions = options.instructions?.trim();
  return {
    kind: "compaction-artifact",
    generatedAt: new Date().toISOString(),
    compactedMessageCount: compactedMessages.length,
    preservedRecentCount,
    ...(instructions ? { instructions } : {}),
    ...(options.providerMarker ? { providerMarker: options.providerMarker } : {}),
    ...summaryArtifact,
  };
}

function formatCompactionArtifact(artifact: CompactionArtifact): string {
  return [
    "[Compacted transcript summary]",
    `Compacted earlier messages: ${artifact.compactedMessageCount}`,
    `Estimated tokens: ${artifact.tokenEstimate}`,
    artifact.instructions ? `Compaction instructions: ${artifact.instructions}` : undefined,
    artifact.providerMarker
      ? `Context marker: ${artifact.providerMarker.providerId ?? "provider"}${artifact.providerMarker.model ? ` / ${artifact.providerMarker.model}` : ""}`
      : undefined,
    "",
    "Summary:",
    artifact.summary,
    "",
    "Highlights:",
    ...artifact.bullets.map((bullet) => `- ${bullet}`),
  ].filter(Boolean).join("\n");
}

export { estimateTokens } from "./tokenEstimation.js";
