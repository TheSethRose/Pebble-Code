import React, { useEffect, useState } from "react";
import { render, Box, Text, useStdout, useInput } from "ink";
import { CommandRegistry } from "../commands/registry.js";
import { registerBuiltinCommands } from "../commands/builtins.js";
import type { CommandContext } from "../commands/types.js";
import { QueryEngine } from "../engine/QueryEngine.js";
import type { PermissionRequest } from "../engine/QueryEngine.js";
import type { AskUserQuestionRequest } from "../engine/QueryEngine.js";
import { resolveRuntimeProvider } from "../providers/runtime.js";
import { createMvpTools } from "../tools/orchestration.js";
import { PermissionManager } from "../runtime/permissionManager.js";
import type { HookContext } from "../runtime/hooks.js";
import { getSettingsPath, loadSettingsForCwd } from "../runtime/config.js";
import { getDefaultExtensionDirs } from "../extensions/loaders.js";
import type { Message, StreamEvent } from "../engine/types.js";
import {
  compactSessionIfNeeded,
  ensureFreshSessionMemory,
  engineMessageToTranscriptMessage,
  failPendingApprovalsForResume,
  transcriptToConversation,
  transcriptToDisplayMessages,
} from "../persistence/runtimeSessions.js";
import type { AppState, DisplayMessage, PendingPermission, PermissionChoice } from "./types.js";

import { PromptInput } from "./components/PromptInput.js";
import type { CommandSuggestion } from "./components/PromptInput.js";
import { JumpToBottomPill } from "./components/JumpToBottomPill.js";
import { MousePressableRegion } from "./components/MousePressableRegion.js";
import { TranscriptView, getTranscriptMetrics } from "./components/TranscriptView.js";
import { MouseScrollableRegion } from "./components/MouseScrollableRegion.js";
import { TerminalMouseProvider } from "./components/TerminalMouseProvider.js";
import { SessionSidebar, SidebarRail, deriveSessionTitle } from "./components/SessionSidebar.js";
import type { SessionSummary } from "./components/SessionSidebar.js";
import { KeybindingsPopup } from "./components/KeybindingsPopup.js";
import { DeleteConfirmDialog } from "./components/DeleteConfirmDialog.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { QuestionPrompt } from "./components/QuestionPrompt.js";
import { Settings } from "./Settings.js";
import type { TabId } from "./Settings.js";
import { formatProgressStatus, formatToolStatus, resolveMaxTurns } from "./toolStatus.js";
import { useVoice } from "./useVoice.js";
import { isFeatureEnabled } from "../build/featureFlags.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCommandConfig(
  cwd: string,
  currentConfig: Record<string, unknown>,
  extensionProviders = contextlessExtensionProviders,
): Record<string, unknown> {
  const settings = loadSettingsForCwd(cwd);
  const resolved = resolveRuntimeProvider(settings, {}, extensionProviders);
  return {
    ...currentConfig,
    permissionMode: settings.permissionMode,
    provider: resolved.providerId,
    providerLabel: resolved.providerLabel,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    apiKeyConfigured: resolved.apiKeyConfigured,
    apiKeySource: resolved.apiKeySource,
    compactThreshold: settings.compactThreshold,
    shellCompactionMode: settings.shellCompactionMode,
    fullscreenRenderer: settings.fullscreenRenderer,
    voiceEnabled: isFeatureEnabled("voiceMode") && settings.voiceEnabled,
    voiceProvider: settings.voiceProvider,
    voiceBaseUrl: settings.voiceBaseUrl,
    voiceTranscribePath: settings.voiceTranscribePath,
    voiceModel: settings.voiceModel,
    settingsPath: getSettingsPath(cwd),
  };
}

const SPACE_HOLD_THRESHOLD = 5;
const SPACE_WARMUP_THRESHOLD = 2;
const SPACE_RAPID_GAP_MS = 120;

function countBareSpaces(input: string): number {
  if (!input) {
    return 0;
  }

  const normalized = input.replace(/\u3000/g, " ");
  return /^ +$/u.test(normalized) ? normalized.length : 0;
}

function stripTrailingSpaces(value: string, maxStrip: number): string {
  if (maxStrip <= 0 || value.length === 0) {
    return value;
  }

  let trailing = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === " " && trailing < maxStrip; index -= 1) {
    trailing += 1;
  }

  return trailing > 0 ? value.slice(0, value.length - trailing) : value;
}

function appendTranscriptToInputValue(currentValue: string, transcript: string): string {
  const trimmedCurrent = currentValue.replace(/[ ]+$/u, "");
  if (!trimmedCurrent) {
    return transcript;
  }

  return /\s$/u.test(trimmedCurrent) ? `${trimmedCurrent}${transcript}` : `${trimmedCurrent} ${transcript}`;
}

const contextlessExtensionProviders: CommandContext["extensionProviders"] = [];

/**
 * Redact sensitive arguments before echoing a command into the transcript.
 */
function redactCommandEcho(name: string, args: string): string {
  const trimmed = args.trim();
  if (!trimmed) return `/${name}`;
  if (name === "login") {
    const tokens = trimmed.split(/\s+/);
    return tokens.length > 1 ? `/${name} ${tokens[0]} [redacted]` : `/${name} [redacted]`;
  }
  if (name === "config" && /^api-key\b/i.test(trimmed)) return `/${name} api-key [redacted]`;
  return `/${name} ${trimmed}`;
}

const INITIAL_STATE: AppState = {
  messages: [],
  isProcessing: false,
  statusText: "",
  error: null,
  activeSessionId: null,
  pendingPermission: null,
  pendingQuestion: null,
};

function finalizeStreamingMessages(messages: DisplayMessage[]): DisplayMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  if (last?.role === "streaming") {
    next[next.length - 1] = {
      ...last,
      role: "assistant",
    };
  }
  return next;
}

function toToolArgs(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toHookContext(context: {
  sessionId?: string | null;
  turnCount?: number;
  toolName?: string;
  toolCallId?: string;
  toolInput?: unknown;
  toolSuccess?: boolean;
  error?: Error;
}): HookContext {
  return {
    sessionId: context.sessionId ?? undefined,
    turnCount: context.turnCount,
    toolName: context.toolName,
    toolCallId: context.toolCallId,
    toolInput: context.toolInput,
    toolSuccess: context.toolSuccess,
    error: context.error,
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App({
  context,
  testController,
}: {
  context: CommandContext;
  testController?: { onPendingPermission?: (pending: PendingPermission | null) => void };
}) {
  const [runtimeConfig, setRuntimeConfig] = React.useState<Record<string, unknown>>(() =>
    loadCommandConfig(context.cwd, context.config, context.extensionProviders),
  );
  const [state, setState] = React.useState<AppState>(INITIAL_STATE);
  const [showSettings, setShowSettings] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<TabId>("config");
  const [inputValue, setInputValue] = React.useState("");
  const [suggestionQuery, setSuggestionQuery] = React.useState("");
  const [inputKey, setInputKey] = React.useState(0);
  const [inputDefaultValue, setInputDefaultValue] = React.useState("");
  const [ctrlCOnce, setCtrlCOnce] = React.useState(false);
  const [suggestionIndex, setSuggestionIndex] = React.useState(0);
  const [sidebarSessions, setSidebarSessions] = React.useState<SessionSummary[]>([]);
  const [sidebarVisible, setSidebarVisible] = React.useState(true);
  const [focusArea, setFocusArea] = React.useState<"input" | "sidebar">("input");
  const [sidebarIndex, setSidebarIndex] = React.useState(0);
  const [inputHistory, setInputHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const [showKeybindings, setShowKeybindings] = React.useState(false);
  const [transcriptScrollOffset, setTranscriptScrollOffset] = React.useState(0);
  const [blinkPhase, setBlinkPhase] = React.useState(true);
  const [voiceWarmup, setVoiceWarmup] = React.useState(false);
  const [voiceError, setVoiceError] = React.useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<{
    sessionId: string;
    title: string;
    selectedButton: "delete" | "cancel";
  } | null>(null);

  const engineRef = React.useRef<QueryEngine | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const hookSessionIdRef = React.useRef<string | null>(null);
  const ctrlCTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTranscriptLineCountRef = React.useRef(0);
  const inputValueRef = React.useRef("");
  const voiceRapidCountRef = React.useRef(0);
  const voiceWarmupCountRef = React.useRef(0);
  const voiceRapidResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceHoldActiveRef = React.useRef(false);
  const trimVoiceSpacesOnIdleRef = React.useRef(false);
  const sessionStore = context.sessionStore ?? null;
  const extensionDirs = context.extensionDirs ?? getDefaultExtensionDirs(context.cwd);

  inputValueRef.current = inputValue;

  const reconcilePendingApprovals = React.useCallback((sessionId: string) => {
    if (!sessionStore || !context.permissionManager) {
      return;
    }

    failPendingApprovalsForResume(
      sessionStore,
      context.permissionManager,
      sessionId,
      "Pending approval expired when the session was resumed.",
    );
  }, [context.permissionManager, sessionStore]);

  const applyStreamEvent = React.useCallback((event: StreamEvent) => {
    const data = event.data as Record<string, unknown> | undefined;

    if (event.type === "text_delta" && (data?.text || data?.delta)) {
      const delta = String(data?.text ?? data?.delta ?? "");
      setState((prev) => {
        const msgs = [...prev.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "streaming") {
          msgs[msgs.length - 1] = { ...last, content: last.content + delta };
        } else {
          msgs.push({ role: "streaming", content: delta });
        }
        return { ...prev, messages: msgs, statusText: "Responding…" };
      });
      return;
    }

    if (event.type === "tool_call" && data?.tool) {
      const toolName = String(data.tool);
      setState((prev) => ({
        ...prev,
        statusText: formatToolStatus(toolName, data.input, "running"),
        messages: [
          ...finalizeStreamingMessages(prev.messages),
          {
            role: "tool",
            content: toolName,
            meta: {
              toolName,
              toolArgs: toToolArgs(data.input),
              toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : undefined,
              qualifiedToolName: typeof data.qualifiedToolName === "string" ? data.qualifiedToolName : undefined,
              requestedToolName: typeof data.requestedToolName === "string" ? data.requestedToolName : undefined,
            },
          },
        ],
      }));
      return;
    }

    if (event.type === "tool_result" && data?.tool) {
      const toolName = String(data.tool);
      const isError = data.success === false;
      setState((prev) => ({
        ...prev,
        statusText: isError ? "" : formatToolStatus(toolName, data.input, "analyzing"),
        messages: [
          ...finalizeStreamingMessages(prev.messages),
          {
            role: "tool_result",
            content: `${toolName} ${isError ? "failed" : "done"}`,
            meta: {
              toolName,
              toolArgs: toToolArgs(data.input),
              toolOutput: typeof data.output === "string" ? data.output : undefined,
              isError,
              errorMessage: typeof data.error === "string" ? data.error : undefined,
              toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : undefined,
              qualifiedToolName: typeof data.qualifiedToolName === "string" ? data.qualifiedToolName : undefined,
              requestedToolName: typeof data.requestedToolName === "string" ? data.requestedToolName : undefined,
              summary: typeof data.summary === "string" ? data.summary : undefined,
              durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
              truncated: data.truncated === true,
            },
          },
        ],
      }));
      return;
    }

    if (event.type === "permission_denied" && data?.tool) {
      const toolName = String(data.tool);
      const reason = typeof data.reason === "string" ? data.reason : "Permission denied";
      setState((prev) => ({
        ...prev,
        statusText: "",
        messages: [
          ...finalizeStreamingMessages(prev.messages),
          {
            role: "tool_result",
            content: `${toolName} denied`,
            meta: {
              toolName,
              toolArgs: toToolArgs(data.input),
              toolOutput: `Tool execution denied: ${reason}`,
              isError: true,
              errorMessage: reason,
              toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : undefined,
              summary: typeof data.approvalMessage === "string" ? data.approvalMessage : undefined,
            },
          },
        ],
      }));
      return;
    }

    if (event.type === "progress" && data) {
      setState((prev) => ({
        ...prev,
        statusText: formatProgressStatus(prev.statusText, {
          turn: data.turn,
          maxTurns: data.maxTurns,
        }),
      }));
      return;
    }

    if (event.type === "error" && data) {
      setState((prev) => ({
        ...prev,
        statusText: "",
        messages: [
          ...finalizeStreamingMessages(prev.messages),
          {
            role: "error",
            content: String(data.message ?? "Unknown error"),
            meta: { isError: true },
          },
        ],
      }));
      return;
    }

    if (event.type === "done") {
      setState((prev) => ({
        ...prev,
        statusText: "",
        messages: finalizeStreamingMessages(prev.messages),
      }));
    }
  }, []);

  // ------------------------------------------------------------------
  // Unified input helpers
  // ------------------------------------------------------------------
  const setInputText = React.useCallback(
    (value: string, updateQuery = false) => {
      setInputValue(value);
      setInputDefaultValue(value);
      if (updateQuery) setSuggestionQuery(value);
      setInputKey((k) => k + 1);
    },
    [],
  );

  const clearInput = React.useCallback(() => {
    setInputValue("");
    setInputDefaultValue("");
    setSuggestionQuery("");
    setSuggestionIndex(0);
    setInputKey((k) => k + 1);
  }, []);

  const voiceEnabled = runtimeConfig.voiceEnabled === true;
  const voiceConnectionOptions = React.useMemo(() => ({
    provider: typeof runtimeConfig.voiceProvider === "string" ? runtimeConfig.voiceProvider : undefined,
    baseUrl: typeof runtimeConfig.voiceBaseUrl === "string" ? runtimeConfig.voiceBaseUrl : undefined,
    transcribePath: typeof runtimeConfig.voiceTranscribePath === "string" ? runtimeConfig.voiceTranscribePath : undefined,
    model: typeof runtimeConfig.voiceModel === "string" ? runtimeConfig.voiceModel : undefined,
  }), [
    runtimeConfig.voiceBaseUrl,
    runtimeConfig.voiceModel,
    runtimeConfig.voiceProvider,
    runtimeConfig.voiceTranscribePath,
  ]);

  const voice = useVoice({
    enabled: voiceEnabled,
    onTranscript: (text) => {
      setVoiceError(null);
      setInputText(appendTranscriptToInputValue(inputValueRef.current, text), true);
    },
    onError: (message) => {
      setVoiceError(message);
    },
    connectionOptions: voiceConnectionOptions,
  });

  React.useEffect(() => {
    if (voice.state === "recording") {
      setVoiceError(null);
    }

    if (voice.state !== "recording") {
      voiceHoldActiveRef.current = false;
      setVoiceWarmup(false);
      voiceRapidCountRef.current = 0;
      voiceWarmupCountRef.current = 0;
      if (voiceRapidResetRef.current) {
        clearTimeout(voiceRapidResetRef.current);
        voiceRapidResetRef.current = null;
      }
    }

    if (voice.state === "idle" && trimVoiceSpacesOnIdleRef.current) {
      trimVoiceSpacesOnIdleRef.current = false;
      const trimmed = inputValueRef.current.replace(/[ ]+$/u, "");
      if (trimmed !== inputValueRef.current) {
        setInputText(trimmed, true);
      }
    }
  }, [setInputText, voice.state]);

  // ------------------------------------------------------------------
  // Session list for sidebar
  // ------------------------------------------------------------------
  const refreshSessions = React.useCallback(() => {
    if (!sessionStore) return;
    const list = sessionStore.listSessions();
    const summaries: SessionSummary[] = list.map((s) => {
      const transcript = sessionStore.loadTranscript(s.id);
      return {
        id: s.id,
        title: transcript ? deriveSessionTitle(transcript.messages) : "New chat",
        updatedAt: s.updatedAt,
        status: s.status,
        messageCount: s.messageCount,
      };
    });
    setSidebarSessions(summaries);
  }, [sessionStore]);

  // Refresh session list on mount and whenever the active session changes.
  React.useEffect(() => {
    refreshSessions();
  }, [refreshSessions, state.activeSessionId]);

  React.useEffect(() => {
    setSidebarIndex((current) => Math.min(current, sidebarSessions.length));
  }, [sidebarSessions.length]);

  const handleSessionSelect = React.useCallback(
    (selectedId: string | null) => {
      if (selectedId === null) {
        // New chat — clear state, let next prompt create a session
        sessionIdRef.current = null;
        setState({ ...INITIAL_STATE });
        refreshSessions();
        return;
      }
      if (selectedId === sessionIdRef.current) return;
      if (!sessionStore) return;

      const transcript = sessionStore.loadTranscript(selectedId);
      if (!transcript) return;

      reconcilePendingApprovals(transcript.id);
      const refreshedTranscript = sessionStore.loadTranscript(transcript.id) ?? transcript;

      sessionIdRef.current = refreshedTranscript.id;
      setState((prev) => ({
        ...prev,
        messages: transcriptToDisplayMessages(refreshedTranscript) as DisplayMessage[],
        activeSessionId: refreshedTranscript.id,
        error: null,
        statusText: "",
      }));
    },
    [reconcilePendingApprovals, sessionStore, refreshSessions],
  );

  const activateSidebarSelection = React.useCallback(
    (nextIndex: number, options: { focusArea?: "input" | "sidebar" } = {}) => {
      const clampedIndex = Math.max(0, Math.min(nextIndex, sidebarSessions.length));
      const selectedId = clampedIndex === 0 ? null : (sidebarSessions[clampedIndex - 1]?.id ?? null);

      setSidebarIndex(clampedIndex);
      handleSessionSelect(selectedId);
      setFocusArea(options.focusArea ?? "input");
    },
    [handleSessionSelect, sidebarSessions],
  );

  const openDeleteConfirm = React.useCallback(
    (session: SessionSummary, index: number, focusArea: "input" | "sidebar" = "sidebar") => {
      setSidebarIndex(index);
      setFocusArea(focusArea);
      setDeleteConfirm({ sessionId: session.id, title: session.title, selectedButton: "cancel" });
    },
    [],
  );

  const handleDeleteSession = React.useCallback(
    (sessionId: string) => {
      if (!sessionStore) return;
      sessionStore.deleteSession(sessionId);

      // If we deleted the active session, reset to new chat
      if (sessionIdRef.current === sessionId) {
        sessionIdRef.current = null;
        setState({ ...INITIAL_STATE });
        setSidebarIndex(0);
      }

      refreshSessions();

      // If no sessions remain, ensure we're on a new chat
      const remaining = sessionStore.listSessions();
      setSidebarIndex((current) => Math.min(current, remaining.length));
      if (remaining.length === 0) {
        sessionIdRef.current = null;
        setState({ ...INITIAL_STATE });
        setSidebarIndex(0);
      }
    },
    [sessionStore, refreshSessions],
  );

  const registry = React.useMemo(() => {
    const reg = new CommandRegistry();
    registerBuiltinCommands(reg);
    reg.registerMany(context.extensionCommands ?? []);
    return reg;
  }, [context.extensionCommands]);

  // Slash-command suggestions: filtered by what the user actually typed (suggestionQuery),
  // not inputValue, so scrolling through suggestions doesn't collapse the list.
  const suggestions = React.useMemo((): CommandSuggestion[] => {
    if (!suggestionQuery.startsWith("/") || suggestionQuery.includes(" ")) return [];
    const query = suggestionQuery.slice(1).toLowerCase();
    const listCtx = { cwd: context.cwd, headless: false, config: runtimeConfig };
    return registry
      .list(listCtx)
      .filter(
        (c) =>
          c.name.startsWith(query) ||
          (c.aliases ?? []).some((a) => a.startsWith(query)),
      )
      .map((c) => ({ name: c.name, description: c.description }));
  }, [suggestionQuery, registry, context.cwd, runtimeConfig]);

  // Reset selection to top whenever the suggestion list changes (e.g. user types more).
  React.useEffect(() => {
    setSuggestionIndex(0);
  }, [suggestions.length, suggestionQuery]);

  // ------------------------------------------------------------------
  // Engine initialisation
  // ------------------------------------------------------------------
  const rebuildEngine = React.useCallback((activeRuntimeConfig: Record<string, unknown>) => {
    const settings = loadSettingsForCwd(context.cwd);
    const resolvedProvider = resolveRuntimeProvider(
      settings,
      {
        provider: typeof activeRuntimeConfig.provider === "string" ? activeRuntimeConfig.provider : undefined,
        model: typeof activeRuntimeConfig.model === "string" ? activeRuntimeConfig.model : undefined,
      },
      context.extensionProviders ?? [],
    );
    const tools = createMvpTools(context.extensionTools ?? []);
    const permissionManager =
      context.permissionManager ??
      new PermissionManager({ mode: "always-ask", projectRoot: context.cwd });
    const maxTurns = resolveMaxTurns(activeRuntimeConfig.maxTurns, settings.maxTurns ?? 50);

    const resolvePermission = (request: PermissionRequest): Promise<import("../runtime/permissions.js").PermissionDecision> => {
      return new Promise((resolve) => {
        setState((prev) => ({
          ...prev,
          pendingPermission: {
            toolName: request.toolName,
            toolArgs: request.toolArgs,
            approvalMessage: request.approvalMessage,
            resolve: (choice: PermissionChoice) => {
              setState((p) => ({ ...p, pendingPermission: null }));
              resolve(choice);
            },
          },
        }));
      });
    };

    const resolveQuestion = (request: AskUserQuestionRequest): Promise<string> => {
      return new Promise((resolve) => {
        setState((prev) => ({
          ...prev,
          statusText: "Waiting for your answer…",
          pendingQuestion: {
            question: request.question,
            options: request.options,
            allowFreeform: request.allowFreeform,
            resolve: (answer: string) => {
              setState((current) => ({
                ...current,
                pendingQuestion: null,
                statusText: current.isProcessing ? "Continuing…" : "",
              }));
              resolve(answer);
            },
          },
        }));
      });
    };

    engineRef.current = new QueryEngine({
      provider: resolvedProvider.provider,
      tools,
      maxTurns,
      systemPrompt: context.systemPrompt,
      permissionManager,
      cwd: context.cwd,
      shellCompactionMode: settings.shellCompactionMode,
      sessionStore: sessionStore ?? undefined,
      getSessionId: () => sessionIdRef.current,
      extensionDirs,
      skills: context.loadedSkills,
      mcpServers: context.loadedMcpServers,
      onLifecycleEvent: (event, lifecycleContext) => context.hookRegistry?.fire(event, toHookContext(lifecycleContext)),
      resolvePermission,
      resolveQuestion,
      onEvent: applyStreamEvent,
    });
  }, [
    applyStreamEvent,
    context.cwd,
    context.extensionProviders,
    context.extensionTools,
    context.hookRegistry,
    context.loadedMcpServers,
    context.loadedSkills,
    context.permissionManager,
    context.systemPrompt,
    extensionDirs,
    sessionStore,
  ]);

  const refreshRuntimeConfig = React.useCallback(() => {
    const nextRuntimeConfig = loadCommandConfig(context.cwd, runtimeConfig, context.extensionProviders);
    setRuntimeConfig(nextRuntimeConfig);
    rebuildEngine(nextRuntimeConfig);
  }, [context.cwd, context.extensionProviders, rebuildEngine, runtimeConfig]);

  React.useEffect(() => {
    rebuildEngine(runtimeConfig);
  }, [
    rebuildEngine,
    runtimeConfig,
  ]);

  React.useEffect(() => {
    return () => {
      if (context.hookRegistry && hookSessionIdRef.current) {
        void context.hookRegistry.fire("session:end", { sessionId: hookSessionIdRef.current });
        hookSessionIdRef.current = null;
      }
    };
  }, [context.hookRegistry]);

  // ------------------------------------------------------------------
  // Session resume — only when launched with --resume/--continue
  // (context.sessionId set by CLI). Fresh launches start with no session.
  // ------------------------------------------------------------------
  React.useEffect(() => {
    if (!context.sessionId || !sessionStore) return;

    const transcript = compactSessionIfNeeded(
      sessionStore,
      context.sessionId,
      getCompactThreshold(runtimeConfig.compactThreshold),
    ) ?? sessionStore.loadTranscript(context.sessionId);
    if (!transcript) return;

    reconcilePendingApprovals(transcript.id);
    const refreshedTranscript = sessionStore.loadTranscript(transcript.id) ?? transcript;

    sessionIdRef.current = refreshedTranscript.id;
    setState((prev) => ({
      ...prev,
      messages: transcriptToDisplayMessages(refreshedTranscript) as DisplayMessage[],
      activeSessionId: refreshedTranscript.id,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — intentionally not re-running on id change

  // ------------------------------------------------------------------
  // Keyboard: Tab focus, ↑↓ navigation, Ctrl+C exit, Cmd+P, Delete
  // ------------------------------------------------------------------
  useInput(
    (input, key) => {
      if (!state.pendingPermission || showSettings || showKeybindings) {
        return;
      }

      if (key.escape || input === "\u001B") {
        state.pendingPermission.resolve("deny");
      }
    },
    { isActive: Boolean(state.pendingPermission) },
  );

  useInput(
    (_input, key) => {
      const spaceCount = countBareSpaces(_input);

      // --- Delete confirmation dialog (absorbs all keys while open) ---
      if (deleteConfirm) {
        if (key.leftArrow || key.rightArrow) {
          setDeleteConfirm((prev) =>
            prev
              ? { ...prev, selectedButton: prev.selectedButton === "delete" ? "cancel" : "delete" }
              : null,
          );
          return;
        }
        if (key.return) {
          if (deleteConfirm.selectedButton === "delete") {
            handleDeleteSession(deleteConfirm.sessionId);
          }
          setDeleteConfirm(null);
          return;
        }
        if (key.escape) {
          setDeleteConfirm(null);
          return;
        }
        return;
      }

      const voiceCanCapture = voiceEnabled
        && focusArea === "input"
        && !state.isProcessing
        && spaceCount > 0
        && !key.ctrl
        && !key.meta
        && !key.shift
        && !key.tab
        && !key.escape;

      if (voiceCanCapture) {
        if (voiceHoldActiveRef.current || voice.state === "recording") {
          trimVoiceSpacesOnIdleRef.current = true;
          voice.handleKeyEvent();
          return;
        }

        voiceRapidCountRef.current += spaceCount;
        voiceWarmupCountRef.current = Math.min(SPACE_WARMUP_THRESHOLD, voiceWarmupCountRef.current + spaceCount);
        setVoiceWarmup(voiceWarmupCountRef.current >= SPACE_WARMUP_THRESHOLD);

        if (voiceRapidResetRef.current) {
          clearTimeout(voiceRapidResetRef.current);
        }
        voiceRapidResetRef.current = setTimeout(() => {
          voiceRapidResetRef.current = null;
          voiceRapidCountRef.current = 0;
          voiceWarmupCountRef.current = 0;
          setVoiceWarmup(false);
        }, SPACE_RAPID_GAP_MS);

        if (voiceRapidCountRef.current >= SPACE_HOLD_THRESHOLD) {
          voiceHoldActiveRef.current = true;
          trimVoiceSpacesOnIdleRef.current = true;
          const stripped = stripTrailingSpaces(inputValueRef.current, SPACE_HOLD_THRESHOLD);
          if (stripped !== inputValueRef.current) {
            setInputText(stripped, true);
          }
          setVoiceWarmup(false);
          voiceRapidCountRef.current = 0;
          voiceWarmupCountRef.current = 0;
          voice.handleKeyEvent();
          return;
        }
      }

      // --- Keybindings popup (Cmd+P on macOS, Ctrl+P elsewhere) ---
      if ((key.meta && _input === "p") || (key.ctrl && _input === "p")) {
        setShowKeybindings((prev) => !prev);
        return;
      }

      // Tab toggles focus between input and sidebar (only when no suggestions and sidebar visible)
      if (key.tab && suggestions.length === 0 && sidebarVisible) {
        setFocusArea((prev) => (prev === "input" ? "sidebar" : "input"));
        return;
      }

      // --- Sidebar focused ---
      if (focusArea === "sidebar") {
        const maxIndex = sidebarSessions.length; // 0=New Chat, 1..N=sessions
        if (key.upArrow) {
          setSidebarIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setSidebarIndex((i) => Math.min(maxIndex, i + 1));
          return;
        }
        if (key.return) {
          activateSidebarSelection(sidebarIndex, { focusArea: "input" });
          return;
        }
        // Delete / Backspace key — opens confirm dialog for session rows only
        // macOS Delete key → \x7F → key.backspace; fn+Delete → key.delete
        if ((key.backspace || key.delete) && sidebarIndex > 0) {
          const session = sidebarSessions[sidebarIndex - 1];
          if (session) {
            openDeleteConfirm(session, sidebarIndex, "sidebar");
          }
          return;
        }
        if (key.escape) {
          setFocusArea("input");
          return;
        }
        if (key.ctrl && _input === "c") {
          setFocusArea("input");
          return;
        }
        return;
      }

      // --- Input focused with slash-command suggestions visible ---
      if (suggestions.length > 0) {
        if (key.upArrow) {
          setSuggestionIndex((i) => {
            const next = Math.max(0, i - 1);
            const selected = suggestions[next];
            if (selected) setInputText(`/${selected.name}`);
            return next;
          });
          return;
        }
        if (key.downArrow) {
          setSuggestionIndex((i) => {
            const next = Math.min(suggestions.length - 1, i + 1);
            const selected = suggestions[next];
            if (selected) setInputText(`/${selected.name}`);
            return next;
          });
          return;
        }
        if (key.tab) {
          const selected = suggestions[suggestionIndex];
          if (selected) setInputText(`/${selected.name} `, true);
          return;
        }
      }

      // --- Input focused: ↑↓ to cycle prompt history ---
      if (suggestions.length === 0 && inputHistory.length > 0) {
        if (key.upArrow) {
          setHistoryIndex((prev) => {
            const next = Math.min(prev + 1, inputHistory.length - 1);
            setInputText(inputHistory[next] ?? "");
            return next;
          });
          return;
        }
        if (key.downArrow) {
          setHistoryIndex((prev) => {
            const next = prev - 1;
            if (next < 0) {
              setInputText("");
              return -1;
            }
            setInputText(inputHistory[next] ?? "");
            return next;
          });
          return;
        }
      }

      // --- Transcript scroll: Page Up / Page Down ---
      if (key.pageUp) {
        setTranscriptScrollOffset((prev) => Math.min(maxTranscriptScrollOffset, prev + scrollStep));
        return;
      }
      if (key.pageDown) {
        setTranscriptScrollOffset((prev) => Math.max(0, prev - scrollStep));
        return;
      }
      if (key.end) {
        setTranscriptScrollOffset(0);
        return;
      }

      if (key.ctrl && _input === "c") {
        if (inputValue.length > 0) {
          clearInput();
          return;
        }
        if (ctrlCOnce) {
          if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current);
          process.exit(0);
          return;
        }
        setCtrlCOnce(true);
        ctrlCTimerRef.current = setTimeout(() => setCtrlCOnce(false), 2000);
      }
    },
    { isActive: !showSettings && !showKeybindings && !state.pendingPermission && !state.pendingQuestion },
  );

  // ------------------------------------------------------------------
  // Command / prompt handler
  // ------------------------------------------------------------------
  const handleSubmit = React.useCallback(
    async (input: string) => {
      let trimmed = input.trim();
      if (!trimmed) return;

      // If suggestions are visible and the user pressed Enter on a partial,
      // expand to the currently-selected suggestion instead of submitting the prefix.
      if (
        suggestions.length > 0 &&
        trimmed.startsWith("/") &&
        !trimmed.includes(" ")
      ) {
        const selected = suggestions[Math.min(suggestionIndex, suggestions.length - 1)];
        if (selected) {
          trimmed = `/${selected.name}`;
        }
      }

      // Scroll back to bottom so the user sees new responses.
      setTranscriptScrollOffset(0);

      // Clear the input field immediately on every submission
      clearInput();

      // Push to input history (most recent first) and reset cursor
      setInputHistory((prev) => [trimmed, ...prev.slice(0, 99)]);
      setHistoryIndex(-1);

      // Dismiss exit warning on any submission
      setCtrlCOnce(false);
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
        ctrlCTimerRef.current = null;
      }

      const commandContext: CommandContext = {
        ...context,
        config: runtimeConfig,
        sessionStore: sessionStore ?? undefined,
        sessionId: sessionIdRef.current,
      };

      // ---- Slash commands ----------------------------------------
      if (registry.isCommand(trimmed, commandContext)) {
        const parsed = registry.parseCommand(trimmed);
        if (!parsed) return;

        const result = await registry.execute(parsed.name, parsed.args, commandContext);

        // /config — open the settings panel
        if (result.data?.action === "open-settings") {
          const tab = (result.data.defaultTab as TabId | undefined) ?? "config";
          setSettingsTab(tab);
          setShowSettings(true);
          return;
        }

        // /clear — wipe conversation, reset session
        if (result.data?.action === "clear") {
          sessionIdRef.current = null;
          setState({ ...INITIAL_STATE });
          return;
        }

        // /resume — load a saved session on demand
        if (result.data?.action === "resume-session" && sessionStore) {
          const sid = typeof result.data.sessionId === "string" ? result.data.sessionId : null;
          const transcript = sid
            ? sessionStore.loadTranscript(sid)
            : sessionStore.getLatestSession();
          if (transcript) {
            reconcilePendingApprovals(transcript.id);
            const refreshedTranscript = sessionStore.loadTranscript(transcript.id) ?? transcript;
            sessionIdRef.current = refreshedTranscript.id;
            setState((prev) => ({
              ...prev,
              messages: transcriptToDisplayMessages(refreshedTranscript) as DisplayMessage[],
              activeSessionId: refreshedTranscript.id,
            }));
          }
        }

        // /config changes — reload config
        if (result.data?.action === "config-updated") {
          refreshRuntimeConfig();
        }

        // /sidebar — toggle sidebar visibility
        if (result.data?.action === "sidebar-toggle") {
          setSidebarVisible((prev) => {
            if (prev && focusArea === "sidebar") {
              setFocusArea("input");
            }
            return !prev;
          });
        }

        // Echo command + output into transcript (skip empty output like /clear)
        if (result.output) {
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "command", content: redactCommandEcho(parsed.name, parsed.args) },
              { role: "output", content: result.output },
            ],
          }));
        }

        if (result.exit) {
          if (sessionStore && sessionIdRef.current) {
            sessionStore.updateStatus(sessionIdRef.current, "completed");
          }
          process.exit(0);
        }

        return;
      }

      // ---- Regular prompt ----------------------------------------
      if (!engineRef.current) {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            { role: "user", content: trimmed },
            { role: "assistant", content: "Engine not initialized." },
          ],
          error: "Engine not initialized.",
        }));
        return;
      }

      // Lazily create a fresh session on the first real prompt.
      // Never auto-resume the latest session — that requires an explicit /resume.
      if (!sessionIdRef.current && sessionStore) {
        const session = sessionStore.createSession();
        sessionIdRef.current = session.id;
        setState((prev) => ({ ...prev, activeSessionId: session.id }));
      }

      if (context.hookRegistry && sessionIdRef.current && hookSessionIdRef.current !== sessionIdRef.current) {
        if (hookSessionIdRef.current) {
          await context.hookRegistry.fire("session:end", { sessionId: hookSessionIdRef.current });
        }

        await context.hookRegistry.fire("session:start", { sessionId: sessionIdRef.current });
        hookSessionIdRef.current = sessionIdRef.current;
      }

      // Persist user message
      if (sessionStore && sessionIdRef.current) {
        sessionStore.appendMessage(sessionIdRef.current, {
          role: "user",
          content: trimmed,
          timestamp: new Date().toISOString(),
        });
        compactSessionIfNeeded(
          sessionStore,
          sessionIdRef.current,
          getCompactThreshold(runtimeConfig.compactThreshold),
        );
      }

      // Build conversation history from the stored transcript.
      // Cast to Message[] — transcriptToConversation only ever produces valid roles.
      let conversation: Message[];
      if (sessionStore && sessionIdRef.current) {
        const transcript = ensureFreshSessionMemory(sessionStore, sessionIdRef.current)
          ?? sessionStore.loadTranscript(sessionIdRef.current);
        conversation = (
          transcript
            ? transcriptToConversation(
                transcript,
                getCompactThreshold(runtimeConfig.compactThreshold),
              )
            : [{ role: "user", content: trimmed }]
        ) as Message[];
      } else {
        conversation = [{ role: "user", content: trimmed }] as Message[];
      }

      setState((prev) => ({
        ...prev,
        isProcessing: true,
        messages: [...prev.messages, { role: "user", content: trimmed }],
        error: null,
        statusText: "Working…",
      }));

      try {
        if (context.hookRegistry && sessionIdRef.current) {
          await context.hookRegistry.fire("turn:before", { sessionId: sessionIdRef.current });
        }

        const iterator = engineRef.current.stream(conversation)[Symbol.asyncIterator]();
        let result: Awaited<ReturnType<QueryEngine["process"]>> | null = null;

        while (true) {
          const step = await iterator.next();
          if (step.done) {
            result = step.value;
            break;
          }

          applyStreamEvent(step.value);
        }

        if (!result) {
          throw new Error("Streaming query completed without a terminal result");
        }

        if (context.hookRegistry && sessionIdRef.current) {
          await context.hookRegistry.fire("turn:after", { sessionId: sessionIdRef.current });
        }

        // Persist assistant messages
        if (sessionStore && sessionIdRef.current) {
          for (const msg of result.messages.slice(conversation.length)) {
            const tm = engineMessageToTranscriptMessage(msg);
            if (tm) sessionStore.appendMessage(sessionIdRef.current, tm);
          }
          compactSessionIfNeeded(
            sessionStore,
            sessionIdRef.current,
            getCompactThreshold(runtimeConfig.compactThreshold),
          );
          sessionStore.updateStatus(
            sessionIdRef.current,
            result.success ? "completed" : result.state === "interrupted" ? "interrupted" : "error",
          );
        }

        // Rebuild display from persisted transcript so it stays in sync.
        // transcriptToDisplayMessages returns {role: string}[] which satisfies DisplayMessage.
        let displayMessages: DisplayMessage[];
        if (sessionStore && sessionIdRef.current) {
          const refreshed = sessionStore.loadTranscript(sessionIdRef.current);
          displayMessages = (refreshed
            ? transcriptToDisplayMessages(refreshed).filter((m) => m.role !== "streaming")
            : state.messages.filter((m) => m.role !== "streaming")) as DisplayMessage[];
        } else {
          displayMessages = state.messages.filter((m) => m.role !== "streaming");
        }

        setState((prev) => ({
          ...prev,
          isProcessing: false,
          messages: displayMessages,
          error: result.state === "error" ? (result.error ?? null) : null,
          statusText: "",
        }));
        refreshSessions();
      } catch (err) {
        if (sessionStore && sessionIdRef.current) {
          sessionStore.updateStatus(sessionIdRef.current, "error");
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (context.hookRegistry && sessionIdRef.current) {
          await context.hookRegistry.fire("error", {
            sessionId: sessionIdRef.current,
            error: err instanceof Error ? err : new Error(msg),
          });
        }
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          messages: [...prev.messages, { role: "assistant", content: `Error: ${msg}` }],
          error: msg,
          statusText: "",
        }));
        refreshSessions();
      }
    },
    // state.messages intentionally omitted — we only need it for the fallback
    // non-persisted path. Including it would cause stale-closure issues.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, context, runtimeConfig, sessionStore, refreshSessions, suggestions, suggestionIndex, reconcilePendingApprovals, refreshRuntimeConfig],
  );

  const model = String(runtimeConfig.model ?? "default");
  const providerLabel = typeof runtimeConfig.providerLabel === "string"
    ? runtimeConfig.providerLabel
    : undefined;
  const isFullscreen = runtimeConfig.fullscreenRenderer !== false;
  const { columns, rows } = useTerminalDimensions();

  React.useEffect(() => {
    testController?.onPendingPermission?.(state.pendingPermission);
  }, [state.pendingPermission, testController]);

  React.useEffect(() => {
    if (!state.isProcessing) {
      setBlinkPhase(true);
      return;
    }

    const interval = setInterval(() => {
      setBlinkPhase((value) => !value);
    }, 530);

    return () => clearInterval(interval);
  }, [state.isProcessing]);

  // Rows consumed by the fixed input bar + outer padding.
  // Input bar: ~6 rows (top rule + action label + prompt + bottom rule + status + margin)
  // Outer Box padding: 2 rows
  const hasScrolledUp = transcriptScrollOffset > 0;
  const FIXED_UI_ROWS = 8 + (hasScrolledUp ? 1 : 0);
  const HORIZONTAL_FRAME_WIDTH = 2;
  const MAIN_RIGHT_GAP = sidebarVisible ? 1 : 0;
  const transcriptRows = Math.max(4, rows - FIXED_UI_ROWS);
  const sidebarWidth = 35;
  const effectiveSidebarWidth = sidebarVisible ? sidebarWidth : 0;
  const availableWidth = isFullscreen ? Math.max(20, columns - HORIZONTAL_FRAME_WIDTH) : undefined;
  const mainWidth = isFullscreen
    ? Math.max(20, (availableWidth ?? columns) - effectiveSidebarWidth - MAIN_RIGHT_GAP)
    : undefined;
  const transcriptWidth = Math.max(20, mainWidth ?? availableWidth ?? columns);
  const sidebarHeight = isFullscreen ? Math.max(1, rows - 2) : undefined;
  const visibleMsgCount = Math.max(4, Math.floor(transcriptRows / 3));
  const transcriptMetrics = React.useMemo(
    () => getTranscriptMetrics(state.messages, {
      width: transcriptWidth,
      maxRows: transcriptRows,
      maxMessages: visibleMsgCount,
      isProcessing: state.isProcessing,
      banner: {
        cwd: context.cwd,
        model,
        providerLabel,
        sessionId: state.activeSessionId,
      },
    }),
    [context.cwd, model, providerLabel, state.activeSessionId, state.isProcessing, state.messages, transcriptRows, transcriptWidth, visibleMsgCount],
  );
  const transcriptLineCount = transcriptMetrics.totalRows;
  const maxTranscriptScrollOffset = transcriptMetrics.maxScrollOffset;
  const showJumpToBottom = hasScrolledUp && maxTranscriptScrollOffset > 0;

  React.useEffect(() => {
    const previousLineCount = previousTranscriptLineCountRef.current;
    previousTranscriptLineCountRef.current = transcriptLineCount;

    if (previousLineCount === 0) {
      return;
    }

    const delta = transcriptLineCount - previousLineCount;
    setTranscriptScrollOffset((current) => {
      const maxOffset = maxTranscriptScrollOffset;
      if (delta > 0 && current > 0) {
        return Math.min(maxOffset, current + delta);
      }
      return Math.min(current, maxOffset);
    });
  }, [maxTranscriptScrollOffset, transcriptLineCount]);

  const scrollStep = Math.max(3, Math.floor(transcriptRows / 2));
  const mouseScrollStep = 2;
  const handleTranscriptWheelUp = React.useCallback(() => {
    setTranscriptScrollOffset((prev) => Math.min(maxTranscriptScrollOffset, prev + mouseScrollStep));
  }, [maxTranscriptScrollOffset]);
  const handleTranscriptWheelDown = React.useCallback(() => {
    setTranscriptScrollOffset((prev) => Math.max(0, prev - mouseScrollStep));
  }, []);

  // --- Modals rendered as full-screen replacements (Ink has no z-index) ---
  if (deleteConfirm) {
    const dialog = (
      <Box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        width={isFullscreen ? columns : undefined}
        height={isFullscreen ? rows : undefined}
      >
        <DeleteConfirmDialog
          title={deleteConfirm.title}
          selectedButton={deleteConfirm.selectedButton}
          mouseEnabled={isFullscreen}
          onDelete={() => {
            handleDeleteSession(deleteConfirm.sessionId);
            setDeleteConfirm(null);
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      </Box>
    );

    return isFullscreen ? <TerminalMouseProvider>{dialog}</TerminalMouseProvider> : dialog;
  }

  if (showKeybindings) {
    return (
      <Box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        width={isFullscreen ? columns : undefined}
        height={isFullscreen ? rows : undefined}
      >
        <KeybindingsPopup
          onClose={() => setShowKeybindings(false)}
          width={Math.min(columns - 4, 62)}
        />
      </Box>
    );
  }

  if (showSettings) {
    return (
      <Settings
        context={context}
        defaultTab={settingsTab}
        onClose={() => {
          setShowSettings(false);
          setSettingsTab("config");
          refreshRuntimeConfig();
        }}
      />
    );
  }

  const appBody = (
    <Box
      flexDirection="row"
      padding={1}
      width={isFullscreen ? columns : undefined}
      height={isFullscreen ? rows : undefined}
    >
      {/* Main content */}
      <Box flexDirection="column" flexGrow={1} width={mainWidth} marginRight={sidebarVisible ? 1 : 0}>
        <Box
          flexDirection="column"
          flexGrow={1}
          justifyContent="flex-start"
        >
          {state.error && !state.isProcessing && (
            <Box marginBottom={1}>
              <Text color="yellow">⚠ {state.error}</Text>
            </Box>
          )}

          {(state.messages.length > 0 || isFullscreen) && (isFullscreen ? (
            <MouseScrollableRegion
              onWheelUp={handleTranscriptWheelUp}
              onWheelDown={handleTranscriptWheelDown}
            >
              <TranscriptView
                messages={state.messages}
                banner={{
                  cwd: context.cwd,
                  model,
                  providerLabel,
                  sessionId: state.activeSessionId,
                }}
                scrollOffset={transcriptScrollOffset}
                isProcessing={state.isProcessing}
                blinkPhase={blinkPhase}
                maxMessages={visibleMsgCount}
                maxRows={transcriptRows}
                width={transcriptWidth}
              />
            </MouseScrollableRegion>
          ) : (
            <TranscriptView
              messages={state.messages}
              banner={{
                cwd: context.cwd,
                model,
                providerLabel,
                sessionId: state.activeSessionId,
              }}
              scrollOffset={transcriptScrollOffset}
              isProcessing={state.isProcessing}
              blinkPhase={blinkPhase}
              maxMessages={visibleMsgCount}
              maxRows={transcriptRows}
              width={transcriptWidth}
            />
          ))}

          {showJumpToBottom && (
            <Box justifyContent="center" marginTop={1}>
              {isFullscreen ? (
                <MousePressableRegion onPress={() => setTranscriptScrollOffset(0)}>
                  <JumpToBottomPill />
                </MousePressableRegion>
              ) : (
                <JumpToBottomPill />
              )}
            </Box>
          )}

          {state.pendingPermission && (
            <PermissionPrompt
              pending={state.pendingPermission}
              width={mainWidth ?? availableWidth ?? columns}
            />
          )}

          {state.pendingQuestion && (
            <QuestionPrompt
              pending={state.pendingQuestion}
              width={mainWidth ?? availableWidth ?? columns}
            />
          )}
        </Box>

        <PromptInput
          isProcessing={state.isProcessing}
          disabled={Boolean(state.pendingPermission || state.pendingQuestion)}
          suspendInputCapture={voice.state !== "idle"}
          onSubmit={handleSubmit}
          onChange={(val) => {
            setInputValue(val);
            setSuggestionQuery(val);
          }}
          inputKey={inputKey}
          defaultValue={inputDefaultValue}
          exitWarning={ctrlCOnce}
          statusText={state.statusText}
          model={model}
          sessionId={state.activeSessionId}
          width={mainWidth ?? availableWidth ?? columns}
          suggestions={suggestions}
          selectedSuggestionIndex={Math.min(suggestionIndex, Math.max(0, suggestions.length - 1))}
          voiceEnabled={voiceEnabled}
          voiceState={voice.state}
          voiceWarmingUp={voiceWarmup}
          voiceAudioLevels={voice.audioLevels}
          voiceError={voiceError}
        />
      </Box>

      {/* Session sidebar */}
      {sidebarVisible && (
        <Box
          flexDirection="row"
          height={sidebarHeight}
          width={sidebarWidth}
        >
          <SidebarRail height={sidebarHeight} isFocused={focusArea === "sidebar"} />
          <SessionSidebar
            sessions={sidebarSessions}
            activeSessionId={state.activeSessionId}
            onSelect={(_sessionId, index) => activateSidebarSelection(index, { focusArea: "input" })}
            onRequestDelete={(session, index) => openDeleteConfirm(session, index, "sidebar")}
            selectedIndex={sidebarIndex}
            isFocused={focusArea === "sidebar"}
            mouseEnabled={isFullscreen}
            width={sidebarWidth - 1}
          />
        </Box>
      )}
    </Box>
  );

  return isFullscreen ? <TerminalMouseProvider>{appBody}</TerminalMouseProvider> : appBody;
}

// ---------------------------------------------------------------------------
// REPL entry point
// ---------------------------------------------------------------------------

export function startREPL(context: CommandContext): Promise<number> {
  return new Promise(() => {
    const { unmount } = render(<App context={context} />, { exitOnCtrlC: false });
    process.once("SIGINT", () => {
      unmount();
      process.exit(130);
    });
  });
}

function useTerminalDimensions() {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState(() => ({
    columns: stdout.columns ?? process.stdout.columns ?? 80,
    rows: stdout.rows ?? process.stdout.rows ?? 24,
  }));

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        columns: stdout.columns ?? process.stdout.columns ?? 80,
        rows: stdout.rows ?? process.stdout.rows ?? 24,
      });
    };

    handleResize();
    stdout.on("resize", handleResize);

    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  return dimensions;
}

function getCompactThreshold(value: unknown): number | undefined {
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
