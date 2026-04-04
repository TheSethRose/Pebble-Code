import React, { useEffect, useState } from "react";
import { render, Box, Text, useStdout, useInput } from "ink";
import { CommandRegistry } from "../commands/registry.js";
import { registerBuiltinCommands } from "../commands/builtins.js";
import type { CommandContext } from "../commands/types.js";
import { QueryEngine } from "../engine/QueryEngine.js";
import { createPrimaryProvider } from "../providers/primary/index.js";
import { resolveProviderConfig } from "../providers/config.js";
import { createMvpTools } from "../tools/orchestration.js";
import { PermissionManager } from "../runtime/permissionManager.js";
import { getSettingsPath, loadSettingsForCwd } from "../runtime/config.js";
import type { Message, StreamEvent } from "../engine/types.js";
import {
  compactSessionIfNeeded,
  engineMessageToTranscriptMessage,
  transcriptToConversation,
  transcriptToDisplayMessages,
} from "../persistence/runtimeSessions.js";
import type { AppState, DisplayMessage } from "./types.js";

import { PromptInput } from "./components/PromptInput.js";
import type { CommandSuggestion } from "./components/PromptInput.js";
import { WelcomeHeader } from "./components/WelcomeHeader.js";
import { TranscriptView } from "./components/TranscriptView.js";
import { SessionSidebar, deriveSessionTitle } from "./components/SessionSidebar.js";
import type { SessionSummary } from "./components/SessionSidebar.js";
import { Settings } from "./Settings.js";
import type { TabId } from "./Settings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCommandConfig(
  cwd: string,
  currentConfig: Record<string, unknown>,
): Record<string, unknown> {
  const settings = loadSettingsForCwd(cwd);
  const resolved = resolveProviderConfig(settings);
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
    fullscreenRenderer: settings.fullscreenRenderer,
    settingsPath: getSettingsPath(cwd),
  };
}

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
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App({ context }: { context: CommandContext }) {
  const [runtimeConfig, setRuntimeConfig] = React.useState<Record<string, unknown>>(() =>
    loadCommandConfig(context.cwd, context.config),
  );
  const [state, setState] = React.useState<AppState>(INITIAL_STATE);
  const [showSettings, setShowSettings] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<TabId>("config");
  const [inputValue, setInputValue] = React.useState("");
  const [inputKey, setInputKey] = React.useState(0);
  const [inputDefaultValue, setInputDefaultValue] = React.useState("");
  const [ctrlCOnce, setCtrlCOnce] = React.useState(false);
  const [suggestionIndex, setSuggestionIndex] = React.useState(0);
  const [sidebarSessions, setSidebarSessions] = React.useState<SessionSummary[]>([]);
  const [focusArea, setFocusArea] = React.useState<"input" | "sidebar">("input");
  const [sidebarIndex, setSidebarIndex] = React.useState(0);
  const [inputHistory, setInputHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);

  const engineRef = React.useRef<QueryEngine | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const ctrlCTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStore = context.sessionStore ?? null;

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

      sessionIdRef.current = transcript.id;
      setState((prev) => ({
        ...prev,
        messages: transcriptToDisplayMessages(transcript) as DisplayMessage[],
        activeSessionId: transcript.id,
        error: null,
        statusText: "",
      }));
    },
    [sessionStore, refreshSessions],
  );

  const registry = React.useMemo(() => {
    const reg = new CommandRegistry();
    registerBuiltinCommands(reg);
    reg.registerMany(context.extensionCommands ?? []);
    return reg;
  }, [context.extensionCommands]);

  // Slash-command suggestions: shown when input starts with / and has no space yet.
  const suggestions = React.useMemo((): CommandSuggestion[] => {
    if (!inputValue.startsWith("/") || inputValue.includes(" ")) return [];
    const query = inputValue.slice(1).toLowerCase();
    const listCtx = { cwd: context.cwd, headless: false, config: runtimeConfig };
    return registry
      .list(listCtx)
      .filter(
        (c) =>
          c.name.startsWith(query) ||
          (c.aliases ?? []).some((a) => a.startsWith(query)),
      )
      .map((c) => ({ name: c.name, description: c.description }));
  }, [inputValue, registry, context.cwd, runtimeConfig]);

  // Reset selection to top whenever the suggestion list changes.
  React.useEffect(() => {
    setSuggestionIndex(0);
  }, [suggestions.length, inputValue]);  // inputValue keeps it fresh on each keystroke

  // ------------------------------------------------------------------
  // Engine initialisation
  // ------------------------------------------------------------------
  React.useEffect(() => {
    const settings = loadSettingsForCwd(context.cwd);
    const provider = createPrimaryProvider({
      settings,
      provider: typeof runtimeConfig.provider === "string" ? runtimeConfig.provider : undefined,
      model: typeof runtimeConfig.model === "string" ? runtimeConfig.model : undefined,
    });
    const tools = createMvpTools();
    const permissionManager =
      context.permissionManager ??
      new PermissionManager({ mode: "always-ask", projectRoot: context.cwd });

    engineRef.current = new QueryEngine({
      provider,
      tools,
      maxTurns: 50,
      permissionManager,
      cwd: context.cwd,
      onEvent: (event: StreamEvent) => {
        const data = event.data as Record<string, unknown> | undefined;

        if (event.type === "text_delta" && (data?.text || data?.delta)) {
          const delta = String(data?.text ?? data?.delta ?? "");
          setState((prev) => {
            const msgs = [...prev.messages];
            const last = msgs[msgs.length - 1];
            if (last?.role === "streaming") {
              msgs[msgs.length - 1] = { role: "streaming", content: last.content + delta };
            } else {
              msgs.push({ role: "streaming", content: delta });
            }
            return { ...prev, messages: msgs };
          });
        }

        if (event.type === "tool_call" && data?.tool) {
          setState((prev) => ({
            ...prev,
            statusText: `Running: ${String(data.tool)}`,
            messages: [...prev.messages, { role: "tool", content: String(data.tool) }],
          }));
        }

        if (event.type === "tool_result" && data?.tool) {
          setState((prev) => ({
            ...prev,
            statusText: "",
            messages: [...prev.messages, { role: "tool_result", content: `${String(data.tool)} done` }],
          }));
        }

        if (event.type === "done") {
          setState((prev) => ({ ...prev, statusText: "" }));
        }
      },
    });
  }, [context.cwd, context.permissionManager, runtimeConfig.model, runtimeConfig.provider]);

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

    sessionIdRef.current = transcript.id;
    setState((prev) => ({
      ...prev,
      messages: transcriptToDisplayMessages(transcript) as DisplayMessage[],
      activeSessionId: transcript.id,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — intentionally not re-running on id change

  // ------------------------------------------------------------------
  // Keyboard: Tab focus, ↑↓ navigation, Ctrl+C exit
  // ------------------------------------------------------------------
  useInput(
    (_input, key) => {
      // Tab toggles focus between input and sidebar
      if (key.tab && suggestions.length === 0) {
        setFocusArea((prev) => (prev === "input" ? "sidebar" : "input"));
        return;
      }

      // --- Sidebar focused: ↑↓ to move, Enter to select, Escape/Tab back ---
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
          const selectedId = sidebarIndex === 0 ? null : (sidebarSessions[sidebarIndex - 1]?.id ?? null);
          handleSessionSelect(selectedId);
          setFocusArea("input");
          return;
        }
        if (key.escape) {
          setFocusArea("input");
          return;
        }
        // Ctrl+C still works from sidebar
        if (key.ctrl && _input === "c") {
          setFocusArea("input");
          return;
        }
        return;
      }

      // --- Input focused with slash-command suggestions visible ---
      if (suggestions.length > 0) {
        if (key.upArrow) {
          setSuggestionIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setSuggestionIndex((i) => Math.min(suggestions.length - 1, i + 1));
          return;
        }
        if (key.tab) {
          const selected = suggestions[suggestionIndex];
          if (selected) {
            const completed = `/${selected.name} `;
            setInputDefaultValue(completed);
            setInputValue(completed);
            setInputKey((k) => k + 1);
          }
          return;
        }
      }

      // --- Input focused: ↑↓ to cycle prompt history ---
      if (suggestions.length === 0 && inputHistory.length > 0) {
        if (key.upArrow) {
          setHistoryIndex((prev) => {
            const next = Math.min(prev + 1, inputHistory.length - 1);
            const value = inputHistory[next] ?? "";
            setInputDefaultValue(value);
            setInputValue(value);
            setInputKey((k) => k + 1);
            return next;
          });
          return;
        }
        if (key.downArrow) {
          setHistoryIndex((prev) => {
            const next = prev - 1;
            if (next < 0) {
              setInputDefaultValue("");
              setInputValue("");
              setInputKey((k) => k + 1);
              return -1;
            }
            const value = inputHistory[next] ?? "";
            setInputDefaultValue(value);
            setInputValue(value);
            setInputKey((k) => k + 1);
            return next;
          });
          return;
        }
      }

      if (key.ctrl && _input === "c") {
        if (inputValue.length > 0) {
          setInputValue("");
          setInputDefaultValue("");
          setInputKey((k) => k + 1);
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
    { isActive: !showSettings },
  );

  // ------------------------------------------------------------------
  // Command / prompt handler
  // ------------------------------------------------------------------
  const handleSubmit = React.useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

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
            sessionIdRef.current = transcript.id;
            setState((prev) => ({
              ...prev,
              messages: transcriptToDisplayMessages(transcript) as DisplayMessage[],
              activeSessionId: transcript.id,
            }));
          }
        }

        // /config changes — reload config
        if (result.data?.action === "config-updated") {
          setRuntimeConfig(loadCommandConfig(context.cwd, runtimeConfig));
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
        const transcript = sessionStore.loadTranscript(sessionIdRef.current);
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
        statusText: "Thinking…",
      }));

      try {
        const result = await engineRef.current.process(conversation);

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
    [registry, context, runtimeConfig, sessionStore, refreshSessions],
  );

  const model = String(runtimeConfig.model ?? "default");
  const providerLabel = typeof runtimeConfig.providerLabel === "string"
    ? runtimeConfig.providerLabel
    : undefined;
  const isFullscreen = runtimeConfig.fullscreenRenderer !== false;
  const { columns, rows } = useTerminalDimensions();
  if (showSettings) {
    return (
      <Settings
        context={context}
        defaultTab={settingsTab}
        onClose={() => {
          setShowSettings(false);
          setSettingsTab("config");
          setRuntimeConfig(loadCommandConfig(context.cwd, runtimeConfig));
        }}
      />
    );
  }

  const sidebarWidth = 26;
  const mainWidth = isFullscreen ? columns - sidebarWidth : undefined;

  return (
    <Box
      flexDirection="row"
      padding={1}
      width={isFullscreen ? columns : undefined}
      height={isFullscreen ? rows : undefined}
    >
      {/* Main content */}
      <Box flexDirection="column" flexGrow={1} width={mainWidth}>
        <Box
          flexDirection="column"
          flexGrow={1}
          justifyContent="flex-start"
        >
          <WelcomeHeader
            cwd={context.cwd}
            model={model}
            providerLabel={providerLabel}
            sessionId={state.activeSessionId}
            width={mainWidth ?? columns}
          />

          {state.error && !state.isProcessing && (
            <Box marginBottom={1}>
              <Text color="yellow">⚠ {state.error}</Text>
            </Box>
          )}

          {state.messages.length > 0 && (
            <TranscriptView
              messages={state.messages}
            />
          )}
        </Box>

        <PromptInput
          isProcessing={state.isProcessing}
          onSubmit={handleSubmit}
          onChange={setInputValue}
          inputKey={inputKey}
          defaultValue={inputDefaultValue}
          exitWarning={ctrlCOnce}
          statusText={state.statusText}
          model={model}
          sessionId={state.activeSessionId}
          width={mainWidth ?? columns}
          suggestions={suggestions}
          selectedSuggestionIndex={Math.min(suggestionIndex, Math.max(0, suggestions.length - 1))}
        />
      </Box>

      {/* Session sidebar */}
      <SessionSidebar
        sessions={sidebarSessions}
        activeSessionId={state.activeSessionId}
        onSelect={handleSessionSelect}
        selectedIndex={sidebarIndex}
        isFocused={focusArea === "sidebar"}
        width={sidebarWidth}
      />
    </Box>
  );
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
