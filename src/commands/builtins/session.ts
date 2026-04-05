import type { Command, CommandResult } from "../types.js";
import { compactSession, ensureFreshSessionMemory } from "../../persistence/runtimeSessions.js";
import { estimateTokens } from "../../persistence/tokenEstimation.js";
import { buildSessionMemory, formatSessionMemory, isSessionMemoryStale } from "../../persistence/memory.js";
import { getActiveSession, getSessionStore } from "./shared.js";

export function createResumeCommand(): Command {
  return {
    name: "resume",
    aliases: ["continue"],
    description: "Resume the last session",
    type: "local",
    usage: "/resume [session-id]",
    modes: ["interactive"],
    execute: (args, ctx): CommandResult => {
      const requestedId = args.trim() || undefined;
      const transcript = getActiveSession(ctx, requestedId);

      if (!transcript) {
        return {
          success: true,
          output: requestedId
            ? `No session found with id: ${requestedId}`
            : "No previous session found to resume.",
        };
      }

      const preview = transcript.messages
        .slice(-3)
        .map((message) => `  ${message.role}: ${message.content.slice(0, 80)}`)
        .join("\n");

      return {
        success: true,
        output: [
          `Resumed session ${transcript.id}`,
          `Messages: ${transcript.messages.length}`,
          `Updated: ${transcript.updatedAt}`,
          preview ? `Recent context:\n${preview}` : "Recent context: (empty)",
        ].join("\n"),
        data: {
          action: "resume-session",
          sessionId: transcript.id,
        },
      };
    },
  };
}

export function createMemoryCommand(): Command {
  return {
    name: "memory",
    aliases: ["mem"],
    description: "Show, refresh, or clear session memory",
    type: "local",
    usage: "/memory [refresh|clear]",
    modes: ["interactive", "telegram"],
    execute: (args, ctx): CommandResult => {
      const action = args.trim().toLowerCase();
      if (action && action !== "refresh" && action !== "clear" && action !== "status") {
        return {
          success: true,
          output: "Usage: /memory [refresh|clear]",
        };
      }

      const store = getSessionStore(ctx);
      const transcript = getActiveSession(ctx);
      if (!transcript) {
        return {
          success: true,
          output: "No persisted session memory is available yet.",
        };
      }

      if (action === "clear") {
        store.clearMemory(transcript.id);
        return {
          success: true,
          output: `Cleared session memory for ${transcript.id}.`,
        };
      }

      const compactThreshold = Number(ctx.config.compactThreshold ?? 0);
      const compactPrepareThreshold = Number(ctx.config.compactPrepareThreshold ?? 0);
      const tokenEstimate = estimateTokens(transcript.messages);
      const projectedCompaction = compactThreshold > 0 && tokenEstimate >= compactThreshold;
      const projectedPrepare = !projectedCompaction
        && compactPrepareThreshold > 0
        && tokenEstimate >= compactPrepareThreshold;
      const shouldRefresh = action === "refresh" || isSessionMemoryStale(transcript.memory, transcript);
      const memory = shouldRefresh
        ? store.updateMemory(transcript.id, buildSessionMemory(transcript)).memory
        : transcript.memory;

      if (!memory) {
        return {
          success: true,
          output: `Session ${transcript.id} has no conversation history to summarize yet.`,
        };
      }

      return {
        success: true,
        output: [
          shouldRefresh ? `Session memory refreshed for ${transcript.id}.` : undefined,
          formatSessionMemory(memory, transcript.id),
          "",
          "Compaction status:",
          `Messages in transcript: ${transcript.messages.length}`,
          `Estimated tokens in transcript: ${tokenEstimate}`,
          `Prepare threshold: ${compactPrepareThreshold || "auto / not configured"}`,
          `Compaction threshold: ${compactThreshold || "not configured"}`,
          `Prepare threshold reached: ${projectedPrepare ? "yes" : "no"}`,
          `Compaction needed: ${projectedCompaction ? "yes" : "no"}`,
          `Compaction instructions: ${typeof ctx.config.compactionInstructions === "string" && ctx.config.compactionInstructions.trim() ? "configured" : "none"}`,
          `Provider compaction markers: ${ctx.config.providerCompactionMarkers === true ? "enabled" : "disabled"}`,
          `Updated: ${transcript.updatedAt}`,
        ].filter(Boolean).join("\n"),
      };
    },
  };
}

export function createCompactCommand(): Command {
  return {
    name: "compact",
    aliases: ["summarize-session"],
    description: "Compact the active session transcript now",
    type: "local",
    usage: "/compact [session-id]",
    modes: ["interactive", "telegram"],
    execute: (args, ctx): CommandResult => {
      const requestedId = args.trim() || undefined;
      const transcript = getActiveSession(ctx, requestedId);

      if (!transcript) {
        return {
          success: true,
          output: requestedId
            ? `No session found with id: ${requestedId}`
            : "No session is available to compact.",
        };
      }

      const store = getSessionStore(ctx);
      const outcome = compactSession(store, transcript.id, {
        ...buildCommandCompactionPolicy(ctx),
        force: true,
        reason: "manual",
      });
      if (!outcome) {
        return {
          success: false,
          output: `Failed to compact session ${transcript.id}.`,
        };
      }

      const refreshed = ensureFreshSessionMemory(store, transcript.id)?.memory;

      if (!outcome.compacted || !outcome.artifact) {
        return {
          success: true,
          output: [
            `Session ${transcript.id} is already within the compaction boundary.`,
            `Messages: ${transcript.messages.length}`,
            refreshed ? `Memory refreshed: ${refreshed.generatedAt}` : undefined,
          ].filter(Boolean).join("\n"),
        };
      }

      return {
        success: true,
        output: [
          `Compacted session ${transcript.id}.`,
          `Messages: ${outcome.previousMessageCount} -> ${outcome.nextMessageCount}`,
          `Artifact generated: ${outcome.artifact.generatedAt}`,
          `Compacted messages: ${outcome.artifact.compactedMessageCount}`,
          outcome.artifact.instructions ? `Instructions: ${outcome.artifact.instructions}` : undefined,
          outcome.artifact.providerMarker
            ? `Context marker: ${outcome.artifact.providerMarker.providerId ?? "provider"}${outcome.artifact.providerMarker.model ? ` / ${outcome.artifact.providerMarker.model}` : ""}`
            : undefined,
          "",
          "Summary:",
          outcome.artifact.summary,
          "",
          "Highlights:",
          ...outcome.artifact.bullets.map((bullet) => `- ${bullet}`),
        ].join("\n"),
      };
    },
  };
}

function buildCommandCompactionPolicy(ctx: { config: Record<string, unknown> }) {
  return {
    compactThreshold: toPositiveNumber(ctx.config.compactThreshold),
    compactPrepareThreshold: toPositiveNumber(ctx.config.compactPrepareThreshold),
    instructions: typeof ctx.config.compactionInstructions === "string"
      ? ctx.config.compactionInstructions
      : undefined,
    providerContext: {
      markersEnabled: ctx.config.providerCompactionMarkers === true,
      providerId: typeof ctx.config.provider === "string" ? ctx.config.provider : undefined,
      model: typeof ctx.config.model === "string" ? ctx.config.model : undefined,
    },
  };
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

export function createPlanCommand(): Command {
  return {
    name: "plan",
    aliases: ["think"],
    description: "Show or create a plan",
    type: "local",
    usage: "/plan [description]",
    modes: ["interactive", "telegram"],
    execute: (args, _ctx): CommandResult => {
      if (args) {
        return { success: true, output: `Plan noted: ${args}` };
      }
      return { success: true, output: "No active plan. Use /plan <description> to create one." };
    },
  };
}