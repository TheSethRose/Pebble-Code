import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, Select } from "@inkjs/ui";
import type { CommandContext } from "../commands/types.js";
import {
  getProjectSettingsPath,
  loadSettingsForCwd,
  saveSettingsForCwd,
  getSettingsPath,
  setStoredProviderCredential,
  type Settings,
} from "../runtime/config.js";
import {
  resolveProviderConfig,
  maskSecret,
} from "../providers/config.js";
import {
  getBuiltinProviderDefinition,
  getBuiltinProviderDefinitions,
  getProviderAuthDescription,
  getProviderCredentialLabel,
  normalizeProviderId,
  providerSupportsManualCredentialEntry,
} from "../providers/catalog.js";
import { listRuntimeProviders, resolveRuntimeProvider } from "../providers/runtime.js";
import {
  OPENROUTER_DEFAULT_MODEL,
} from "../constants/openrouter.js";
import {
  getProviderSelectionAuthFollowUp,
  getProviderAuthStatus,
  type ProviderAuthFollowUp,
  type ProviderAuthStatus,
} from "./settingsFlow.js";
import {
  ensureSettingsProviderDefaults,
  runSettingsProviderLogin,
} from "./providerLogin.js";
import {
  fetchProviderModels,
  uniqueModels,
  type ProviderModel,
} from "./providerModels.js";
import {
  getInitialSettingsModelPhase,
  resolveSettingsPostProviderSelectionNavigation,
  resolveSettingsPostLoginNavigation,
  type SettingsAuthReturnTarget,
  type SettingsModelResumeTarget,
} from "./settingsTransitions.js";

export type TabId = "config" | "provider" | "model" | "api-key";

// ---------------------------------------------------------------------------
// OpenRouter model fetching
// ---------------------------------------------------------------------------

const MANUAL_VALUE = "__manual__";

function buildRuntimeProviderOptions(context: CommandContext): Array<{ label: string; value: string }> {
  return listRuntimeProviders(context.extensionProviders ?? []).map((provider) => ({
    label: provider.source === "extension"
      ? `${provider.name}  (${provider.id}, extension)`
      : `${provider.name}  (${provider.id})`,
    value: provider.id,
  }));
}

function buildBuiltinProviderOptions(): Array<{ label: string; value: string }> {
  return getBuiltinProviderDefinitions().map((provider) => ({
    label: `${provider.label}  (${provider.id})`,
    value: provider.id,
  }));
}

interface AuthProviderOption {
  label: string;
  value: string;
  isAuthenticated: boolean;
}

function renderHighlightedLabel(
  label: string,
  query: string,
  isFocused: boolean,
): React.ReactNode {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return <Text color={isFocused ? "blue" : undefined}>{label}</Text>;
  }

  const lowerLabel = label.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const matchIndex = lowerLabel.indexOf(lowerQuery);

  if (matchIndex < 0) {
    return <Text color={isFocused ? "blue" : undefined}>{label}</Text>;
  }

  const before = label.slice(0, matchIndex);
  const match = label.slice(matchIndex, matchIndex + trimmedQuery.length);
  const after = label.slice(matchIndex + trimmedQuery.length);

  return (
    <>
      <Text color={isFocused ? "blue" : undefined}>{before}</Text>
      <Text color="cyan" bold>{match}</Text>
      <Text color={isFocused ? "blue" : undefined}>{after}</Text>
    </>
  );
}

function AuthProviderList({
  options,
  selectedValue,
  onSelect,
  highlightText,
  visibleOptionCount = 8,
}: {
  options: AuthProviderOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  highlightText?: string;
  visibleOptionCount?: number;
}) {
  const [activeIndex, setActiveIndex] = useState(() => {
    const selectedIndex = options.findIndex((option) => option.value === selectedValue);
    return selectedIndex >= 0 ? selectedIndex : 0;
  });

  useEffect(() => {
    const selectedIndex = options.findIndex((option) => option.value === selectedValue);
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
      return;
    }

    setActiveIndex((current) => {
      if (options.length === 0) {
        return 0;
      }

      return Math.min(current, options.length - 1);
    });
  }, [options, selectedValue]);

  useInput(
    (_char, key) => {
      if (options.length === 0) {
        return;
      }

      if (key.upArrow) {
        setActiveIndex((current) => (current - 1 + options.length) % options.length);
        return;
      }

      if (key.downArrow) {
        setActiveIndex((current) => (current + 1) % options.length);
        return;
      }

      if (key.return) {
        onSelect(options[activeIndex]!.value);
      }
    },
    { isActive: options.length > 0 },
  );

  if (options.length === 0) {
    return <Text dimColor>No providers match that filter.</Text>;
  }

  const windowStart = Math.max(
    0,
    Math.min(
      activeIndex - Math.floor(visibleOptionCount / 2),
      Math.max(0, options.length - visibleOptionCount),
    ),
  );
  const visibleOptions = options.slice(windowStart, windowStart + visibleOptionCount);

  return (
    <Box flexDirection="column">
      {visibleOptions.map((option, offset) => {
        const optionIndex = windowStart + offset;
        const isFocused = optionIndex === activeIndex;

        return (
          <Box key={option.value} flexDirection="row">
            <Text color={isFocused ? "blue" : undefined}>{isFocused ? "› " : "  "}</Text>
            {renderHighlightedLabel(option.label, highlightText ?? "", isFocused)}
            {option.isAuthenticated && <Text color="green"> ✓</Text>}
          </Box>
        );
      })}
    </Box>
  );
}

function formatProviderAuthStatus(status: ProviderAuthStatus): string {
  if (!status.isConfigured || !status.credential) {
    return "not configured";
  }

  switch (status.source) {
    case "settings":
      return `stored in Pebble settings (${maskSecret(status.credential)})`;
    case "env":
      return `configured via ${status.envKey ?? "environment"} (${maskSecret(status.credential)})`;
    case "default":
      return `configured via built-in default (${maskSecret(status.credential)})`;
    case "none":
    default:
      return "not configured";
  }
}

function getProviderAuthActionHint(params: {
  providerId: string;
  manualEntrySupported: boolean;
  implemented: boolean;
  authStatus: ProviderAuthStatus;
  loginState?: ProviderLoginState | null;
}): string {
  if (params.manualEntrySupported) {
    return "Enter to save · ← change provider · Shift+Tab / Tab to switch sections";
  }

  if (params.implemented) {
    if (params.loginState?.status === "running") {
      return "Waiting for browser/device authorization · ← change provider · Shift+Tab / Tab to switch sections";
    }

    if (params.loginState?.status === "error") {
      return "← change provider to retry · Shift+Tab / Tab to switch sections";
    }

    return params.authStatus.isConfigured
      ? `OAuth session saved · re-run /login ${params.providerId} from the main prompt to refresh · ← change provider · Shift+Tab / Tab to switch sections`
      : `Selecting this provider auto-starts its login flow · ← change provider · Shift+Tab / Tab to switch sections`;
  }

  return "← change provider · Shift+Tab / Tab to switch sections";
}

function renderProviderAuthHelp(params: {
  providerId: string;
  providerLabel: string;
  manualEntrySupported: boolean;
  implemented: boolean;
  authStatus: ProviderAuthStatus;
  loginState?: ProviderLoginState | null;
}): React.ReactNode {
  if (params.manualEntrySupported) {
    return null;
  }

  if (params.implemented) {
    const loginState = params.loginState;

    return (
      <Box marginTop={1} flexDirection="column">
        {params.authStatus.isConfigured ? (
          <>
            <Text color="yellow">{params.providerLabel} already has a saved OAuth session.</Text>
            <Text color="cyan">Run: /login {params.providerId}</Text>
            <Text dimColor>Use the slash command if you want to refresh or replace the stored session manually.</Text>
          </>
        ) : (
          <>
            <Text color="yellow">Pebble auto-starts the login flow when you select this provider here.</Text>
            <Text dimColor>It will show the browser/device instructions below and store the resulting OAuth session in ~/.pebble/settings.json.</Text>
          </>
        )}
        {loginState?.lines.length ? (
          <Box marginTop={1} flexDirection="column">
            {loginState.lines.map((line, index) => (
              <Text key={`${params.providerId}:${index}`} dimColor={loginState.status === "running"}>{line}</Text>
            ))}
          </Box>
        ) : null}
        {loginState?.message ? (
          <Box marginTop={1}>
            <Text color={loginState.status === "error" ? "red" : loginState.status === "success" ? "green" : "cyan"}>
              {loginState.message}
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <Text color="yellow">Use the provider-specific OAuth / IAM / browser flow for this provider; Pebble is only cataloging that auth path for now.</Text>
    </Box>
  );
}

interface ProviderLoginState {
  providerId: string;
  status: "running" | "success" | "error";
  lines: string[];
  message?: string;
}

interface SettingsProps {
  context: CommandContext;
  onClose: () => void;
  defaultTab?: TabId;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "config", label: "Config" },
  { id: "provider", label: "Provider" },
  { id: "model", label: "Model" },
  { id: "api-key", label: "Auth" },
];

function TabBar({
  tabs,
  activeTab,
}: {
  tabs: { id: TabId; label: string }[];
  activeTab: TabId;
}) {
  return (
    <Box flexDirection="row" marginBottom={1}>
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTab;
        return (
          <Box key={tab.id} marginRight={i < tabs.length - 1 ? 1 : 0}>
            <Text
              bold={isActive}
              color={isActive ? "black" : "gray"}
              inverse={isActive}
            >
              {` ${tab.label} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function ConfigTab({
  context,
  settings,
  settingsPath,
  projectSettingsPath,
  cwd,
}: {
  context: CommandContext;
  settings: Settings;
  settingsPath: string;
  projectSettingsPath: string;
  cwd: string;
}) {
  const resolved = resolveRuntimeProvider(settings, {}, context.extensionProviders ?? []);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Status</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>Working directory: {cwd}</Text>
        <Text>Project defaults: {projectSettingsPath}</Text>
        <Text>User settings: {settingsPath}</Text>
        <Text>Permission mode: {settings.permissionMode}</Text>
        <Text>Max turns: {settings.maxTurns ?? 50}</Text>
        <Text>Telemetry: {settings.telemetryEnabled ? "enabled" : "disabled"}</Text>
        <Text>Compact threshold: {settings.compactThreshold ?? "not set"}</Text>
        <Text>Fullscreen renderer: {settings.fullscreenRenderer === false ? "disabled" : "enabled"}</Text>
        <Text>Provider: {resolved.providerLabel} ({resolved.providerId})</Text>
        <Text>Model: {resolved.model}</Text>
        <Text>Stored provider credentials: {Object.keys(settings.providerAuth ?? {}).length}</Text>
        <Text>
          API key:{" "}
          {resolved.apiKeyConfigured
            ? `configured via ${resolved.apiKeySource} (${maskSecret(resolved.apiKey)})`
            : "not configured"}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Shift+Tab / Tab to switch sections · Esc to close</Text>
      </Box>
    </Box>
  );
}

const PROVIDER_MANUAL_VALUE = "__manual_provider__";

function ProviderTab({
  context,
  settings,
  onSave,
  onOpenAuth,
  onOpenModelList,
}: {
  context: CommandContext;
  settings: Settings;
  onSave: (s: Settings) => void;
  onOpenAuth: (followUp: ProviderAuthFollowUp, returnTarget?: SettingsAuthReturnTarget) => void;
  onOpenModelList: (message?: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  const resolved = resolveRuntimeProvider(settings, {}, context.extensionProviders ?? []);

  const providerOptions = useMemo<Array<{ label: string; value: string }>>(() => {
    return [
      ...buildRuntimeProviderOptions(context),
      { label: "⌨  Type provider ID manually…", value: PROVIDER_MANUAL_VALUE },
    ];
  }, [context]);

  const filteredProviderOptions = useMemo(() => {
    if (!filterQuery.trim()) return providerOptions;
    const q = filterQuery.toLowerCase();
    return providerOptions.filter(
      (opt) => opt.value === PROVIDER_MANUAL_VALUE || opt.label.toLowerCase().includes(q),
    );
  }, [filterQuery, providerOptions]);

  // Capture printable characters + backspace for filtering when showing list
  useInput(
    (char, key) => {
      if (key.ctrl || key.meta || key.tab || key.escape) return;
      if (key.return || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
      if (key.backspace || key.delete) {
        setFilterQuery((q) => q.slice(0, -1));
        return;
      }
      if (char && char.charCodeAt(0) >= 32) {
        setFilterQuery((q) => q + char);
      }
    },
    { isActive: !showManual },
  );

  const handleProviderSelect = useCallback(
    (value: string) => {
      if (value === PROVIDER_MANUAL_VALUE) {
        setShowManual(true);
        return;
      }

      const provider = normalizeProviderId(value);
      const providerLabel = getBuiltinProviderDefinition(provider)?.label ?? provider;

      if (provider === settings.provider) {
        const followUp = getProviderSelectionAuthFollowUp(settings, provider);
        const navigation = resolveSettingsPostProviderSelectionNavigation({
          providerId: provider,
          providerLabel,
          requiresAuth: Boolean(followUp),
          providerWasChanged: false,
        });

        if (followUp && navigation.authReturnTarget) {
          onOpenAuth(followUp, navigation.authReturnTarget);
          return;
        }

        onOpenModelList(navigation.modelResumeTarget?.message);
        return;
      }

      const next = ensureSettingsProviderDefaults({
        ...settings,
        provider,
        model: undefined,
        baseUrl: undefined,
      });
      onSave(next);

      const followUp = getProviderSelectionAuthFollowUp(next, provider);
      const navigation = resolveSettingsPostProviderSelectionNavigation({
        providerId: provider,
        providerLabel,
        requiresAuth: Boolean(followUp),
        providerWasChanged: true,
      });

      if (followUp && navigation.authReturnTarget) {
        onOpenAuth(followUp, navigation.authReturnTarget);
        return;
      }

      onOpenModelList(navigation.modelResumeTarget?.message);
    },
    [onOpenAuth, onOpenModelList, onSave, settings],
  );

  const handleManualSubmit = useCallback(
    (value: string) => {
      const provider = normalizeProviderId(value);
      if (!provider) {
        setMessage("Provider ID cannot be empty");
        return;
      }

      const next = ensureSettingsProviderDefaults({
        ...settings,
        provider,
        model: undefined,
        baseUrl: undefined,
      });
      onSave(next);

      const followUp = getProviderSelectionAuthFollowUp(next, provider);
      const providerLabel = getBuiltinProviderDefinition(provider)?.label ?? provider;
      const navigation = resolveSettingsPostProviderSelectionNavigation({
        providerId: provider,
        providerLabel,
        requiresAuth: Boolean(followUp),
        providerWasChanged: true,
      });

      if (followUp && navigation.authReturnTarget) {
        onOpenAuth(followUp, navigation.authReturnTarget);
        return;
      }

      onOpenModelList(navigation.modelResumeTarget?.message);
    },
    [onOpenAuth, onOpenModelList, onSave, settings],
  );

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Provider</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>Current: {resolved.providerLabel} ({resolved.providerId})</Text>
        <Text>Base URL: {resolved.baseUrl}</Text>

        {!showManual && (
          <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text dimColor>Filter: </Text>
              <Text color="cyan">{filterQuery}</Text>
              <Text dimColor>█</Text>
            </Box>
            <Box marginTop={1}>
              <Select
                key={filterQuery}
                options={filteredProviderOptions}
                visibleOptionCount={5}
                defaultValue={resolved.providerId}
                onChange={handleProviderSelect}
                highlightText={filterQuery || undefined}
              />
            </Box>
          </Box>
        )}

        {showManual && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Provider ID:</Text>
            <Box marginTop={1}>
              <Text color="cyan">{"› "} </Text>
              <TextInput
                onSubmit={handleManualSubmit}
                placeholder="Provider (e.g. openrouter)"
              />
            </Box>
          </Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith("Unsupported") ? "red" : "green"}>
              {message}
            </Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {showManual
            ? "Enter to save · Shift+Tab / Tab to switch sections"
            : "Type to filter · ↑↓ navigate · Enter select · Tab to switch sections"}
        </Text>
      </Box>
    </Box>
  );
}

function ModelTab({
  context,
  settings,
  onSave,
  onOpenAuth,
  resumeTarget,
}: {
  context: CommandContext;
  settings: Settings;
  onSave: (s: Settings) => void;
  onOpenAuth: (followUp: ProviderAuthFollowUp, returnTarget?: SettingsAuthReturnTarget) => void;
  resumeTarget?: SettingsModelResumeTarget | null;
}) {
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [phase, setPhase] = useState<"provider" | "model">(
    () => getInitialSettingsModelPhase(resumeTarget),
  );
  const [providerFilterQuery, setProviderFilterQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState("");

  const resolved = resolveRuntimeProvider(settings, {}, context.extensionProviders ?? []);
  const providerOptions = useMemo(() => buildRuntimeProviderOptions(context), [context]);
  const filteredProviderOptions = useMemo(() => {
    if (!providerFilterQuery.trim()) {
      return providerOptions;
    }

    const q = providerFilterQuery.toLowerCase();
    return providerOptions.filter((option) => option.label.toLowerCase().includes(q));
  }, [providerFilterQuery, providerOptions]);
  const providerDefinition = getBuiltinProviderDefinition(resolved.providerId);
  const requestHeadersKey = JSON.stringify(resolved.requestHeaders);

  const seededModels = useMemo<ProviderModel[]>(() => {
    return uniqueModels([
      ...(resolved.model ? [{ id: resolved.model }] : []),
      ...(providerDefinition?.exampleModels.map((id) => ({ id })) ?? []),
    ]);
  }, [providerDefinition, resolved.model]);

  const availableModels = useMemo(
    () => uniqueModels([...models, ...seededModels]),
    [models, seededModels],
  );

  useEffect(() => {
    if (!resumeTarget) {
      return;
    }

    setPhase(resumeTarget.phase);
    setProviderFilterQuery("");
    setFilterQuery("");
    setShowManual(false);
    setModels([]);
    setLoadError("");
    setMessage(resumeTarget.message ?? "Authentication validated. Pick a model below.");
  }, [resumeTarget]);

  useEffect(() => {
    if (phase !== "model" || showManual) {
      return;
    }

    if (resolved.source !== "builtin" || resolved.transport !== "openai-compatible" || !resolved.baseUrl) {
      setModels([]);
      return;
    }

    setLoading(true);
    setLoadError("");
    fetchProviderModels({
      providerId: resolved.providerId,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      requestHeaders: resolved.requestHeaders,
    })
      .then((nextModels) => {
        setModels(nextModels);
        setLoading(false);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoading(false);
        setModels([]);
      });
  }, [
    phase,
    requestHeadersKey,
    resolved.apiKey,
    resolved.baseUrl,
    resolved.providerId,
    resolved.source,
    resolved.transport,
    showManual,
  ]);

  const modelOptions = useMemo(() => {
    const options = availableModels.map((model) => ({
      label: model.name ? `${model.id}  —  ${model.name}` : model.id,
      value: model.id,
    }));
    options.push({ label: "⌨  Type model ID manually…", value: MANUAL_VALUE });
    return options;
  }, [availableModels]);

  const filteredOptions = useMemo(() => {
    if (!filterQuery.trim()) {
      return modelOptions;
    }

    const q = filterQuery.toLowerCase();
    return modelOptions.filter(
      (option) => option.value === MANUAL_VALUE || option.label.toLowerCase().includes(q),
    );
  }, [filterQuery, modelOptions]);

  const matchCount = filterQuery.trim()
    ? filteredOptions.filter((option) => option.value !== MANUAL_VALUE).length
    : availableModels.length;
  const showPicker = phase === "model" && !showManual && availableModels.length > 0 && !loading;

  useInput(
    (char, key) => {
      if (key.ctrl || key.meta || key.tab || key.escape) return;
      if (key.return || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;

      if (key.backspace || key.delete) {
        if (phase === "provider") {
          setProviderFilterQuery((value) => value.slice(0, -1));
          return;
        }

        setFilterQuery((value) => value.slice(0, -1));
        return;
      }

      if (char && char.charCodeAt(0) >= 32) {
        if (phase === "provider") {
          setProviderFilterQuery((value) => value + char);
          return;
        }

        setFilterQuery((value) => value + char);
      }
    },
    { isActive: phase === "provider" || showPicker },
  );

  useInput(
    (_char, key) => {
      if (phase === "model" && key.leftArrow) {
        setPhase("provider");
        setFilterQuery("");
        setShowManual(false);
      }
    },
    { isActive: phase === "model" },
  );

  const handleProviderSelect = useCallback(
    (value: string) => {
      const provider = normalizeProviderId(value);
      const changingProvider = provider !== resolved.providerId;
      if (changingProvider) {
        const next = ensureSettingsProviderDefaults({
          ...settings,
          provider,
          model: undefined,
          baseUrl: undefined,
        });
        onSave(next);
        const followUp = getProviderSelectionAuthFollowUp(next, provider);
        if (followUp) {
          onOpenAuth(followUp, {
            tab: "model",
            modelPhase: "model",
            successMessage: `${getBuiltinProviderDefinition(provider)?.label ?? provider} authenticated. Pick a model below.`,
          });
          return;
        }
      } else {
        const followUp = getProviderSelectionAuthFollowUp(settings, provider);
        if (followUp) {
          onOpenAuth(followUp, {
            tab: "model",
            modelPhase: "model",
            successMessage: `${getBuiltinProviderDefinition(provider)?.label ?? provider} authenticated. Pick a model below.`,
          });
          return;
        }
      }

      setPhase("model");
      setProviderFilterQuery("");
      setFilterQuery("");
      setShowManual(false);
      setModels([]);
      setLoadError("");
      setMessage(changingProvider
        ? `Provider set to ${provider}. Pick a model below.`
        : `Provider confirmed: ${provider}. Pick a model below.`);
    },
    [onSave, resolved.providerId, settings],
  );

  const handleSelectChange = useCallback(
    (value: string) => {
      if (value === MANUAL_VALUE) {
        setShowManual(true);
        return;
      }

      if (value === settings.model) {
        return;
      }

      const next = ensureSettingsProviderDefaults({
        ...settings,
        model: value,
      });
      onSave(next);
      setMessage(`Model set to ${value}`);
    },
    [onSave, settings],
  );

  const handleTextSubmit = useCallback(
    (value: string) => {
      if (!value.trim()) {
        setMessage("Model name cannot be empty");
        return;
      }

      const next = ensureSettingsProviderDefaults({
        ...settings,
        model: value.trim(),
      });
      onSave(next);
      setMessage(`Model set to ${value.trim()}`);
    },
    [onSave, settings],
  );

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Model</Text>
      <Box flexDirection="column" marginTop={1}>
        {phase === "provider" ? (
          <>
            <Text>First, choose the provider whose model catalog you want to browse.</Text>
            <Box marginTop={1}>
              <Text dimColor>Filter: </Text>
              <Text color="cyan">{providerFilterQuery}</Text>
              <Text dimColor>█</Text>
            </Box>
            <Box marginTop={1}>
              <Select
                key={providerFilterQuery}
                options={filteredProviderOptions}
                visibleOptionCount={8}
                defaultValue={resolved.providerId}
                onChange={handleProviderSelect}
                highlightText={providerFilterQuery || undefined}
              />
            </Box>
          </>
        ) : (
          <>
            <Text>Provider: {resolved.providerLabel} ({resolved.providerId})</Text>
            <Text>Current model: {resolved.model}</Text>
            <Text dimColor>Use ← to pick a different provider.</Text>

            {loading && (
              <Box marginTop={1}>
                <Text dimColor>Loading models from {resolved.providerLabel}…</Text>
              </Box>
            )}

            {loadError && (
              <Box marginTop={1}>
                <Text color="yellow">Could not refresh live model list: {loadError}</Text>
              </Box>
            )}

            {resolved.source === "extension" && !loading && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="yellow">This provider is managed by an extension, so Pebble only offers manual model overrides here.</Text>
              </Box>
            )}

            {showPicker && (
              <Box flexDirection="column" marginTop={1}>
                <Box>
                  <Text dimColor>Filter: </Text>
                  <Text color="cyan">{filterQuery}</Text>
                  <Text dimColor>█  </Text>
                  <Text dimColor>
                    {filterQuery.trim()
                      ? `${matchCount} of ${availableModels.length} models`
                      : `${availableModels.length} models · type to filter`}
                  </Text>
                </Box>
                <Box marginTop={1}>
                  <Select
                    key={`${resolved.providerId}:${filterQuery}`}
                    options={filteredOptions}
                    visibleOptionCount={10}
                    defaultValue={resolved.model}
                    onChange={handleSelectChange}
                    highlightText={filterQuery || undefined}
                  />
                </Box>
              </Box>
            )}

            {(showManual || (!loading && !showPicker)) && (
              <Box flexDirection="column" marginTop={1}>
                {showManual && availableModels.length > 0 && (
                  <Text dimColor>Manual entry:</Text>
                )}
                {!showManual && !showPicker && (
                  <Text color="yellow">No seeded model catalog is available for this provider yet, so enter a model ID manually.</Text>
                )}
                <Box marginTop={1}>
                  <Text color="cyan">{"› "} </Text>
                  <TextInput
                    onSubmit={handleTextSubmit}
                    placeholder={`Model ID (e.g. ${resolved.model || OPENROUTER_DEFAULT_MODEL})`}
                  />
                </Box>
              </Box>
            )}
          </>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith("Model name") ? "red" : "green"}>
              {message}
            </Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {phase === "provider"
            ? "Type to filter · ↑↓ navigate · Enter select provider · Tab to switch sections"
            : showPicker
              ? "Type to filter · ↑↓ navigate · Enter select model · ← change provider · Tab to switch sections"
              : "Enter to save · ← change provider · Tab to switch sections"}
        </Text>
      </Box>
    </Box>
  );
}

function ApiKeyTab({
  settings,
  onSave,
  initialProviderId,
  initialPhase = "provider",
  notice,
  loginState,
  onAutoLogin,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
  initialProviderId?: string;
  initialPhase?: "provider" | "credential";
  notice?: string;
  loginState?: ProviderLoginState | null;
  onAutoLogin: (providerId: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"provider" | "credential">(initialPhase);
  const [filterQuery, setFilterQuery] = useState("");
  const [lastAutoLoginProviderId, setLastAutoLoginProviderId] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState(
    normalizeProviderId(initialProviderId ?? settings.provider),
  );

  useEffect(() => {
    setSelectedProviderId(normalizeProviderId(initialProviderId ?? settings.provider));
  }, [initialProviderId, settings.provider]);

  useEffect(() => {
    setPhase(initialPhase);
  }, [initialPhase]);

  const providerOptions = useMemo<AuthProviderOption[]>(() => {
    return buildBuiltinProviderOptions().map((option) => ({
      ...option,
      isAuthenticated: getProviderAuthStatus(settings, option.value).isConfigured,
    }));
  }, [settings]);
  const filteredProviderOptions = useMemo(() => {
    if (!filterQuery.trim()) {
      return providerOptions;
    }

    const q = filterQuery.toLowerCase();
    return providerOptions.filter((option) => option.label.toLowerCase().includes(q));
  }, [filterQuery, providerOptions]);
  const selectedDefinition = getBuiltinProviderDefinition(selectedProviderId);
  const resolved = resolveProviderConfig({
    ...settings,
    provider: selectedProviderId,
  });
  const authStatus = getProviderAuthStatus(settings, selectedProviderId);
  const manualEntrySupported = providerSupportsManualCredentialEntry(selectedDefinition);
  const activeLoginState = loginState?.providerId === selectedProviderId ? loginState : null;

  useEffect(() => {
    if (phase !== "credential" || activeLoginState?.status !== "success" || !authStatus.isConfigured) {
      return;
    }

    setPhase("provider");
    setFilterQuery("");
    setLastAutoLoginProviderId(null);
  }, [activeLoginState?.status, authStatus.isConfigured, phase]);

  useEffect(() => {
    const shouldAutoLogin = phase === "credential"
      && selectedDefinition?.authKind === "oauth"
      && resolved.implemented
      && !authStatus.isConfigured;

    if (!shouldAutoLogin) {
      return;
    }

    if (lastAutoLoginProviderId === selectedProviderId) {
      return;
    }

    onAutoLogin(selectedProviderId);
    setLastAutoLoginProviderId(selectedProviderId);
  }, [
    authStatus.isConfigured,
    lastAutoLoginProviderId,
    onAutoLogin,
    phase,
    resolved.implemented,
    selectedDefinition?.authKind,
    selectedProviderId,
  ]);

  const handleSubmit = useCallback(
    (value: string) => {
      if (!selectedDefinition || !manualEntrySupported) {
        setMessage("This provider does not accept a manually pasted credential in Pebble yet.");
        return;
      }
      if (!value.trim()) {
        setMessage(`${getProviderCredentialLabel(selectedDefinition)} cannot be empty`);
        return;
      }
      const next = ensureSettingsProviderDefaults(
        setStoredProviderCredential(settings, selectedProviderId, value.trim()),
      );
      onSave(next);
      setMessage(`${getProviderCredentialLabel(selectedDefinition)} saved for ${selectedDefinition.label}`);
    },
    [manualEntrySupported, onSave, selectedDefinition, selectedProviderId, settings],
  );

  const handleProviderSelect = useCallback((value: string) => {
    setSelectedProviderId(normalizeProviderId(value));
    setPhase("credential");
    setFilterQuery("");
    setMessage("");
    setLastAutoLoginProviderId(null);
  }, []);

  useInput(
    (char, key) => {
      if (phase !== "provider") {
        return;
      }
      if (key.ctrl || key.meta || key.tab || key.escape) return;
      if (key.return || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
      if (key.backspace || key.delete) {
        setFilterQuery((q) => q.slice(0, -1));
        return;
      }
      if (char && char.charCodeAt(0) >= 32) {
        setFilterQuery((q) => q + char);
      }
    },
    { isActive: phase === "provider" },
  );

  useInput(
    (_char, key) => {
      if (phase === "credential" && key.leftArrow) {
        setPhase("provider");
      }
    },
    { isActive: phase === "credential" },
  );

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Authentication</Text>
      <Box flexDirection="column" marginTop={1}>
        {phase === "provider" ? (
          <>
            <Text>Select which provider you want to configure authentication for.</Text>
            <Box marginTop={1}>
              <Text dimColor>Filter: </Text>
              <Text color="cyan">{filterQuery}</Text>
              <Text dimColor>█</Text>
            </Box>
            <Box marginTop={1}>
              <AuthProviderList
                options={filteredProviderOptions}
                selectedValue={selectedProviderId}
                onSelect={handleProviderSelect}
                highlightText={filterQuery || undefined}
              />
            </Box>
          </>
        ) : (
          <>
            {notice && (
              <Box marginBottom={1}>
                <Text color="yellow">{notice}</Text>
              </Box>
            )}
            <Text>Provider: {selectedDefinition?.label ?? resolved.providerLabel} ({selectedProviderId})</Text>
            <Text>Auth mode: {getProviderAuthDescription(selectedDefinition)}</Text>
            <Text>
              Status:{" "}
              {formatProviderAuthStatus(authStatus)}
            </Text>
            <Text>Env vars: {resolved.envKeyNames.join(", ")}</Text>
            {!resolved.implemented && (
              <Text color="yellow">Runtime status: cataloged, but live execution is still unimplemented or un-smoke-tested.</Text>
            )}
            {selectedDefinition?.help && (
              <Text dimColor>{selectedDefinition.help}</Text>
            )}
            {manualEntrySupported ? (
              <Box marginTop={1}>
                <Text color="cyan">{"› "} </Text>
                <TextInput
                  onSubmit={handleSubmit}
                  placeholder={`${getProviderCredentialLabel(selectedDefinition)} (saved to ~/.pebble/settings.json)`}
                />
              </Box>
            ) : (
              renderProviderAuthHelp({
                providerId: selectedProviderId,
                providerLabel: selectedDefinition?.label ?? resolved.providerLabel,
                manualEntrySupported,
                implemented: resolved.implemented,
                authStatus,
                loginState: activeLoginState,
              })
            )}
          </>
        )}
        {message && (
          <Box marginTop={1}>
            <Text color={message.includes("cannot") || message.includes("does not") ? "red" : "green"}>
              {message}
            </Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {phase === "provider"
            ? "Type to filter · ↑↓ navigate · Enter select provider · Shift+Tab / Tab to switch sections"
            : getProviderAuthActionHint({
              providerId: selectedProviderId,
              manualEntrySupported,
              implemented: resolved.implemented,
              authStatus,
              loginState: activeLoginState,
            })}
        </Text>
      </Box>
    </Box>
  );
}

export function Settings({
  context,
  onClose,
  defaultTab = "config",
}: SettingsProps) {
  const [settings, setSettings] = useState<Settings>(() =>
    ensureSettingsProviderDefaults(loadSettingsForCwd(context.cwd)),
  );
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const [authFollowUp, setAuthFollowUp] = useState<ProviderAuthFollowUp | null>(null);
  const [authReturnTarget, setAuthReturnTarget] = useState<SettingsAuthReturnTarget | null>(null);
  const [providerLoginState, setProviderLoginState] = useState<ProviderLoginState | null>(null);
  const [modelResumeTarget, setModelResumeTarget] = useState<SettingsModelResumeTarget | null>(null);
  const activeProviderLoginRef = useRef<string | null>(null);

  const handleSave = useCallback(
    (next: Settings) => {
      saveSettingsForCwd(context.cwd, next);
      setSettings(next);
    },
    [context.cwd],
  );

  const handleTabChange = useCallback(
    (direction: "next" | "prev") => {
      const idx = TABS.findIndex((t) => t.id === activeTab);
      const next =
        direction === "next"
          ? (idx + 1) % TABS.length
          : (idx - 1 + TABS.length) % TABS.length;
      setActiveTab(TABS[next]!.id);
    },
    [activeTab],
  );

  useInput(
    (_input, key) => {
      if (key.tab && !key.shift) {
        handleTabChange("next");
      } else if (key.tab && key.shift) {
        handleTabChange("prev");
      } else if (key.escape) {
        onClose();
      }
    },
    { isActive: true },
  );

  const settingsPath = getSettingsPath(context.cwd);
  const projectSettingsPath = getProjectSettingsPath(context.cwd);

  const openAuthTab = useCallback((followUp: ProviderAuthFollowUp, returnTarget?: SettingsAuthReturnTarget) => {
    setAuthFollowUp(followUp);
    setAuthReturnTarget(returnTarget ?? null);
    setModelResumeTarget(null);
    setActiveTab("api-key");
  }, []);

  const openModelTab = useCallback((message?: string) => {
    setAuthFollowUp(null);
    setAuthReturnTarget(null);
    setModelResumeTarget({
      nonce: Date.now(),
      phase: "model",
      message,
    });
    setActiveTab("model");
  }, []);

  const runProviderLogin = useCallback(async (providerId: string) => {
    if (activeProviderLoginRef.current === providerId) {
      return;
    }

    activeProviderLoginRef.current = providerId;
    setActiveTab("api-key");
    setProviderLoginState({
      providerId,
      status: "running",
      lines: [],
      message: `Starting ${providerId} login…`,
    });

    try {
      const result = await runSettingsProviderLogin({
        providerId,
        settings,
        writeLine: (line) => {
          setProviderLoginState((current) => {
            if (current?.providerId !== providerId) {
              return {
                providerId,
                status: "running",
                lines: [line],
              };
            }

            return {
              ...current,
              status: "running",
              lines: [...current.lines, line],
              message: current.message,
            };
          });
        },
      });

      handleSave(result.nextSettings);
      const navigation = resolveSettingsPostLoginNavigation({
        providerId,
        followUpProviderId: authFollowUp?.providerId,
        returnTarget: authReturnTarget,
      });

      setProviderLoginState((current) => ({
        providerId,
        status: "success",
        lines: current?.providerId === providerId ? current.lines : [],
        message: result.message,
      }));

      if (navigation) {
        setAuthFollowUp(null);
        setAuthReturnTarget(null);
        if (navigation.modelResumeTarget) {
          setModelResumeTarget({
            nonce: Date.now(),
            ...navigation.modelResumeTarget,
          });
        }
        setActiveTab(navigation.nextTab);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setProviderLoginState((current) => ({
        providerId,
        status: "error",
        lines: current?.providerId === providerId ? current.lines : [],
        message,
      }));
    } finally {
      if (activeProviderLoginRef.current === providerId) {
        activeProviderLoginRef.current = null;
      }
    }
  }, [authFollowUp?.providerId, authReturnTarget, handleSave, settings]);

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor="cyan"
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Settings</Text>
        <Text dimColor>{settingsPath}</Text>
      </Box>

      <TabBar tabs={TABS} activeTab={activeTab} />

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        paddingY={1}
        minHeight={10}
      >
        {activeTab === "config" && (
          <ConfigTab
            context={context}
            settings={settings}
            settingsPath={settingsPath}
            projectSettingsPath={projectSettingsPath}
            cwd={context.cwd}
          />
        )}
        {activeTab === "provider" && (
          <ProviderTab
            context={context}
            settings={settings}
            onSave={handleSave}
            onOpenAuth={openAuthTab}
            onOpenModelList={openModelTab}
          />
        )}
        {activeTab === "model" && (
          <ModelTab
            context={context}
            settings={settings}
            onSave={handleSave}
            onOpenAuth={openAuthTab}
            resumeTarget={modelResumeTarget}
          />
        )}
        {activeTab === "api-key" && (
          <ApiKeyTab
            settings={settings}
            onSave={handleSave}
            initialProviderId={authFollowUp?.providerId}
            initialPhase={authFollowUp ? "credential" : "provider"}
            notice={authFollowUp?.notice}
            loginState={providerLoginState}
            onAutoLogin={runProviderLogin}
          />
        )}
      </Box>

      <Box justifyContent="space-between" marginTop={1}>
        <Text dimColor>Esc to close</Text>
        <Text dimColor>Reference-style tabbed panel</Text>
      </Box>
    </Box>
  );
}
