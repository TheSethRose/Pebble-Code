import React from "react";
import { render, Text, Box } from "ink";
import { TextInput } from "@inkjs/ui";
import { CommandRegistry } from "../commands/registry";
import { registerBuiltinCommands } from "../commands/builtins";
import type { CommandContext } from "../commands/types";
import { QueryEngine } from "../engine/QueryEngine";
import { createPrimaryProvider } from "../providers/primary";
import { resolveProviderConfig } from "../providers/config";
import { createMvpTools } from "../tools/orchestration";
import { PermissionManager } from "../runtime/permissionManager";
import { getSettingsPath, loadSettingsForCwd } from "../runtime/config";
import { Settings } from "./Settings.js";
import type { StreamEvent } from "../engine/types";
import { createOrResumeSession, engineMessageToTranscriptMessage, transcriptToConversation, transcriptToDisplayMessages } from "../persistence/runtimeSessions";
import type { SessionStore } from "../persistence/sessionStore";

interface DisplayMessage {
  role: string;
  content: string;
}

interface RecentSessionSummary {
  id: string;
  updatedAt: string;
  status: string;
  messageCount: number;
}

interface AppState {
  messages: DisplayMessage[];
  isProcessing: boolean;
  exitCode: number | null;
  error: string | null;
  statusText: string;
  activeSessionId: string | null;
  recentSessions: RecentSessionSummary[];
}

const VISIBLE_MESSAGE_COUNT = 12;

function loadCommandConfig(cwd: string, currentConfig: Record<string, unknown>): Record<string, unknown> {
  const settings = loadSettingsForCwd(cwd);
  const resolved = resolveProviderConfig(settings);

  return {
    ...currentConfig,
    provider: resolved.providerId,
    providerLabel: resolved.providerLabel,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    apiKeyConfigured: resolved.apiKeyConfigured,
    apiKeySource: resolved.apiKeySource,
    settingsPath: getSettingsPath(cwd),
  };
}

function redactCommandEcho(name: string, args: string): string {
  const trimmed = args.trim();
  if (!trimmed) {
    return `/${name}`;
  }

  if (name === "login") {
    const tokens = trimmed.split(/\s+/);
    return tokens.length > 1
      ? `/${name} ${tokens[0]} [redacted]`
      : `/${name} [redacted]`;
  }

  if (name === "config" && /^api-key\b/i.test(trimmed)) {
    return `/${name} api-key [redacted]`;
  }

  return `/${name} ${trimmed}`;
}

function truncateSessionId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 18)}…` : id;
}

function formatSessionTime(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return updatedAt;
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getRoleMeta(role: string): { label: string; color: string; borderColor: string } {
  switch (role) {
    case "user":
      return { label: "You", color: "blue", borderColor: "blue" };
    case "assistant":
      return { label: "Pebble", color: "green", borderColor: "green" };
    case "command":
      return { label: "Slash command", color: "cyan", borderColor: "cyan" };
    case "output":
      return { label: "Local output", color: "white", borderColor: "gray" };
    case "tool":
      return { label: "Tool activity", color: "yellow", borderColor: "yellow" };
    case "tool_result":
      return { label: "Tool result", color: "green", borderColor: "green" };
    case "streaming":
      return { label: "Streaming", color: "green", borderColor: "green" };
    default:
      return { label: "Message", color: "white", borderColor: "gray" };
  }
}

function listRecentSessions(sessionStore?: SessionStore): RecentSessionSummary[] {
  return (sessionStore?.listSessions() ?? []).slice(0, 5);
}

function StatusPill({ label, value, color = "gray" }: { label: string; value: string; color?: string }) {
  return (
    <Box marginRight={2}>
      <Text color="gray">{label}: </Text>
      <Text color={color}>{value}</Text>
    </Box>
  );
}

function HeaderSurface({
  cwd,
  trustLevel,
  config,
  activeSessionId,
  recentSessions,
  isProcessing,
  statusText,
}: {
  cwd: string;
  trustLevel?: string;
  config: Record<string, unknown>;
  activeSessionId: string | null;
  recentSessions: RecentSessionSummary[];
  isProcessing: boolean;
  statusText: string;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color="cyan">Pebble Code</Text>
          <Text color={isProcessing ? "yellow" : "green"}>{isProcessing ? "Working" : "Ready"}</Text>
        </Box>
        <Text color="gray">{cwd}</Text>
        <Box marginTop={1} flexWrap="wrap">
          <StatusPill label="Trust" value={trustLevel ?? "unknown"} color={trustLevel === "trusted" ? "green" : "yellow"} />
          <StatusPill label="Permissions" value={String(config.permissionMode ?? "unknown")} color="yellow" />
          <StatusPill label="Provider" value={String(config.providerLabel ?? config.provider ?? "default")} color="cyan" />
          <StatusPill label="Model" value={String(config.model ?? "default")} color="magenta" />
          <StatusPill label="Session" value={activeSessionId ? truncateSessionId(activeSessionId) : "new"} color="blue" />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Status: </Text>
          <Text>{statusText}</Text>
        </Box>
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0} flexDirection="column" marginTop={1}>
        <Text bold>Recent sessions</Text>
        {recentSessions.length === 0 ? (
          <Text color="gray">No saved sessions yet — your next prompt will create one.</Text>
        ) : (
          <>
            {recentSessions.map((session) => (
              <Box key={session.id} justifyContent="space-between">
                <Text color={session.id === activeSessionId ? "green" : "white"}>
                  {session.id === activeSessionId ? "●" : "○"} {truncateSessionId(session.id)}
                </Text>
                <Text color="gray">
                  {session.messageCount} msgs • {session.status} • {formatSessionTime(session.updatedAt)}
                </Text>
              </Box>
            ))}
            <Text color="gray">Resume any session with /resume &lt;session-id&gt;.</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

function EmptyState() {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0} flexDirection="column" marginBottom={1}>
      <Text bold>Start here</Text>
      <Text color="gray">Ask Pebble to inspect, edit, review, or explain code. The current session will be saved automatically.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="blue">• “inspect src/runtime/main.ts and summarize the boot flow”</Text>
        <Text color="blue">• “review my unstaged changes”</Text>
        <Text color="blue">• “find where session persistence is wired”</Text>
      </Box>
    </Box>
  );
}

function TranscriptMessageCard({ message }: { message: DisplayMessage }) {
  const meta = getRoleMeta(message.role);

  return (
    <Box borderStyle="round" borderColor={meta.borderColor} paddingX={1} paddingY={0} flexDirection="column" marginBottom={1}>
      <Text bold color={meta.color}>{meta.label}</Text>
      <Text>{message.content || "(empty)"}</Text>
    </Box>
  );
}

function TranscriptSurface({
  messages,
  isProcessing,
}: {
  messages: DisplayMessage[];
  isProcessing: boolean;
}) {
  const visibleMessages = messages.slice(-VISIBLE_MESSAGE_COUNT);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {messages.length > VISIBLE_MESSAGE_COUNT && (
            <Box marginBottom={1}>
              <Text color="gray">Showing the latest {VISIBLE_MESSAGE_COUNT} of {messages.length} messages.</Text>
            </Box>
          )}
          {visibleMessages.map((message, index) => (
            <TranscriptMessageCard key={`${message.role}-${index}-${message.content.slice(0, 20)}`} message={message} />
          ))}
        </>
      )}
      {isProcessing && (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} paddingY={0}>
          <Text color="yellow">Pebble is thinking… tool activity and results will appear here.</Text>
        </Box>
      )}
    </Box>
  );
}

function PromptComposer({
  isProcessing,
  onSubmit,
  statusText,
}: {
  isProcessing: boolean;
  onSubmit: (value: string) => Promise<void>;
  statusText: string;
}) {
  return (
    <Box borderStyle="round" borderColor={isProcessing ? "yellow" : "cyan"} paddingX={1} paddingY={0} flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold>{isProcessing ? "Processing request" : "Prompt composer"}</Text>
        <Text color="gray">/help • /resume • /review • /memory</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={isProcessing ? "yellow" : "cyan"} bold>{"> "}</Text>
        <TextInput
          key={isProcessing ? "busy" : "idle"}
          onSubmit={onSubmit}
          placeholder={isProcessing ? "Pebble is still working…" : "Type a prompt or slash command"}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">{statusText}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">/help • /login • /config • /resume • /review • /memory</Text>
      </Box>
    </Box>
  );
}

export function App({ context }: { context: CommandContext }) {
  const [runtimeConfig, setRuntimeConfig] = React.useState<Record<string, unknown>>(() =>
    loadCommandConfig(context.cwd, context.config),
  );
  const [showSettings, setShowSettings] = React.useState(false);
  const [state, setState] = React.useState<AppState>({
    messages: [],
    isProcessing: false,
    exitCode: null,
    error: null,
    statusText: "Ready for a prompt. Use /help for commands.",
    activeSessionId: context.sessionId ?? null,
    recentSessions: listRecentSessions(context.sessionStore),
  });

  const engineRef = React.useRef<QueryEngine | null>(null);
  const sessionIdRef = React.useRef<string | null>(context.sessionId ?? null);
  const sessionStore = React.useMemo(() => context.sessionStore, [context.sessionStore]);

  const registry = React.useMemo(() => {
    const reg = new CommandRegistry();
    registerBuiltinCommands(reg);
    return reg;
  }, []);

  // Initialize engine on mount
  React.useEffect(() => {
    const settings = loadSettingsForCwd(context.cwd);
    const provider = createPrimaryProvider({
      settings,
      provider: typeof runtimeConfig.provider === "string" ? runtimeConfig.provider : undefined,
      model: typeof runtimeConfig.model === "string" ? runtimeConfig.model : undefined,
    });
    const tools = createMvpTools();
    const permissionManager = context.permissionManager ?? new PermissionManager({
      mode: "always-ask",
      projectRoot: context.cwd,
    });

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
            const messages = [...prev.messages];
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === "streaming") {
              messages[messages.length - 1] = {
                role: "streaming",
                content: lastMsg.content + delta,
              };
            } else {
              messages.push({ role: "streaming", content: delta });
            }
            return { ...prev, messages, statusText: "Streaming response…" };
          });
        }
        if (event.type === "progress") {
          const turn = typeof data?.turn === "number" ? data.turn : undefined;
          const maxTurns = typeof data?.maxTurns === "number" ? data.maxTurns : undefined;
          setState((prev) => ({
            ...prev,
            statusText: turn && maxTurns ? `Running turn ${turn} of ${maxTurns}` : "Working through the request…",
          }));
        }
        if (event.type === "tool_call" && data?.tool) {
          setState((prev) => ({
            ...prev,
            statusText: `Running tool: ${String(data.tool)}`,
            messages: [
              ...prev.messages,
              { role: "tool", content: `🔧 Calling ${data.tool}...` },
            ],
          }));
        }
        if (event.type === "tool_result" && data?.tool) {
          setState((prev) => ({
            ...prev,
            statusText: `Tool finished: ${String(data.tool)}`,
            messages: [
              ...prev.messages,
              { role: "tool_result", content: `✅ ${data.tool} completed` },
            ],
          }));
        }
        if (event.type === "permission_denied" && data?.tool) {
          setState((prev) => ({
            ...prev,
            error: `Permission denied for ${String(data.tool)}`,
            statusText: `Permission denied for ${String(data.tool)}`,
          }));
        }
        if (event.type === "done") {
          setState((prev) => ({
            ...prev,
            statusText: "Ready for the next prompt.",
          }));
        }
      },
    });
  }, [context.cwd, context.permissionManager, runtimeConfig.model, runtimeConfig.provider]);

  React.useEffect(() => {
    if (!sessionStore) {
      return;
    }

    const activeSession = createOrResumeSession(sessionStore, context.sessionId ?? undefined);
    sessionIdRef.current = activeSession.id;
    setState((prev) => ({
      ...prev,
      messages: transcriptToDisplayMessages(activeSession),
      activeSessionId: activeSession.id,
      recentSessions: listRecentSessions(sessionStore),
      statusText: activeSession.messages.length > 0
        ? `Loaded session ${truncateSessionId(activeSession.id)} with ${activeSession.messages.length} messages.`
        : "Ready for a prompt. Use /help for commands.",
    }));
  }, [context.sessionId, sessionStore]);

  const refreshSessionChrome = React.useCallback((activeSessionId?: string | null) => {
    setState((prev) => ({
      ...prev,
      activeSessionId: activeSessionId ?? prev.activeSessionId,
      recentSessions: listRecentSessions(sessionStore),
    }));
  }, [sessionStore]);

  const buildCommandContext = React.useCallback((): CommandContext => ({
    ...context,
    config: runtimeConfig,
    sessionStore,
    sessionId: sessionIdRef.current,
  }), [context, runtimeConfig, sessionStore]);

  const loadSession = React.useCallback((sessionId?: string | null) => {
    if (!sessionStore) {
      return null;
    }

    const transcript = sessionId
      ? sessionStore.loadTranscript(sessionId)
      : sessionStore.getLatestSession();

    if (!transcript) {
      return null;
    }

    sessionIdRef.current = transcript.id;
    setState((prev) => ({
      ...prev,
      messages: transcriptToDisplayMessages(transcript),
      error: null,
      activeSessionId: transcript.id,
      recentSessions: listRecentSessions(sessionStore),
      statusText: `Resumed session ${truncateSessionId(transcript.id)}.`,
    }));
    return transcript;
  }, [sessionStore]);

  const handleSubmit = React.useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      // Check if it's a command
      const commandContext = buildCommandContext();

      if (registry.isCommand(trimmed, commandContext)) {
        const parsed = registry.parseCommand(trimmed);
        if (parsed) {
          const result = await registry.execute(
            parsed.name,
            parsed.args,
            commandContext,
          );

          if (result.data?.action === "resume-session") {
            loadSession(typeof result.data.sessionId === "string" ? result.data.sessionId : null);
          }

          if (result.data?.action === "config-updated") {
            setRuntimeConfig(loadCommandConfig(context.cwd, runtimeConfig));
          }

          // If the command is /config, show the settings UI instead of text output
          if (parsed.name === "config") {
            setShowSettings(true);
            return;
          }

          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "command", content: redactCommandEcho(parsed.name, parsed.args) },
              { role: "output", content: result.output },
            ],
            exitCode: result.exit ? 0 : prev.exitCode,
            statusText: result.output || `Executed /${parsed.name}`,
          }));
          if (result.exit) {
            if (sessionStore && sessionIdRef.current) {
              sessionStore.updateStatus(sessionIdRef.current, "completed");
            }
            process.exit(0);
          }
        }
        return;
      }

      // Regular prompt - send to engine
      if (!engineRef.current) {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            { role: "user", content: trimmed },
            { role: "assistant", content: "Engine not initialized. Restart Pebble and try again." },
          ],
          error: "Engine not initialized.",
        }));
        return;
      }

      if (!sessionStore) {
        setState((prev) => ({
          ...prev,
          error: "Session store not initialized",
        }));
        return;
      }

      const activeSession = createOrResumeSession(sessionStore, sessionIdRef.current ?? undefined);
      sessionIdRef.current = activeSession.id;
      refreshSessionChrome(activeSession.id);

      sessionStore.appendMessage(activeSession.id, {
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      });

      const transcript = sessionStore.loadTranscript(activeSession.id) ?? activeSession;
      const conversation = transcriptToConversation(
        transcript,
        typeof context.config.compactThreshold === "number"
          ? context.config.compactThreshold
          : Number(context.config.compactThreshold ?? 0) || undefined,
      );

      setState((prev) => ({
        ...prev,
        isProcessing: true,
        messages: [...prev.messages, { role: "user", content: trimmed }],
        error: null,
        activeSessionId: activeSession.id,
        recentSessions: listRecentSessions(sessionStore),
        statusText: "Dispatching prompt to the query engine…",
      }));

      try {
        const result = await engineRef.current.process(conversation);

        const newMessages = result.messages.slice(conversation.length);
        for (const message of newMessages) {
          const transcriptMessage = engineMessageToTranscriptMessage(message);
          if (transcriptMessage) {
            sessionStore.appendMessage(activeSession.id, transcriptMessage);
          }
        }

        sessionStore.updateStatus(
          activeSession.id,
          result.success ? "completed" : result.state === "interrupted" ? "interrupted" : "error",
        );

        const refreshedTranscript = sessionStore.loadTranscript(activeSession.id) ?? activeSession;

        setState((prev) => {
          const filtered = transcriptToDisplayMessages(refreshedTranscript).filter((m) => m.role !== "streaming");

          if (result.state === "error") {
            return {
              ...prev,
              isProcessing: false,
              messages: filtered,
              error: result.error ?? null,
              statusText: result.error ?? "The last request failed.",
            };
          }

          return {
            ...prev,
            isProcessing: false,
            messages: filtered,
            activeSessionId: activeSession.id,
            recentSessions: listRecentSessions(sessionStore),
            statusText: "Ready for the next prompt.",
          };
        });
      } catch (error) {
        sessionStore.updateStatus(activeSession.id, "error");
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          messages: [
            ...prev.messages,
            { role: "assistant", content: `Error: ${error instanceof Error ? error.message : String(error)}` },
          ],
          error: error instanceof Error ? error.message : String(error),
          statusText: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [registry, context, buildCommandContext, loadSession, refreshSessionChrome, sessionStore],
  );

  return (
    <Box flexDirection="column" padding={1}>
      {showSettings ? (
        <Settings
          context={buildCommandContext()}
          onClose={() => {
            setShowSettings(false);
            setRuntimeConfig(loadCommandConfig(context.cwd, runtimeConfig));
          }}
          defaultTab="config"
        />
      ) : (
        <>
          <HeaderSurface
            cwd={context.cwd}
            trustLevel={context.trustLevel}
            config={runtimeConfig}
            activeSessionId={state.activeSessionId}
            recentSessions={state.recentSessions}
            isProcessing={state.isProcessing}
            statusText={state.statusText}
          />

          {state.error && (
            <Box marginBottom={1}>
              <Box borderStyle="round" borderColor="yellow" paddingX={1} paddingY={0}>
                <Text color="yellow">⚠ {state.error}</Text>
              </Box>
            </Box>
          )}

          <TranscriptSurface messages={state.messages} isProcessing={state.isProcessing} />

          <PromptComposer
            isProcessing={state.isProcessing}
            onSubmit={handleSubmit}
            statusText={state.statusText}
          />
        </>
      )}
    </Box>
  );
}

export function startREPL(context: CommandContext): Promise<number> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <App context={context} />,
      {
        exitOnCtrlC: false,
      }
    );

    // Handle cleanup
    process.on("SIGINT", () => {
      unmount();
      resolve(0);
    });
  });
}
