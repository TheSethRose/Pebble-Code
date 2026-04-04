import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, Select } from "@inkjs/ui";
import type { CommandContext } from "../commands/types.js";
import {
  getProjectSettingsPath,
  loadSettingsForCwd,
  saveSettingsForCwd,
  getSettingsPath,
  type Settings,
} from "../runtime/config.js";
import {
  resolveProviderConfig,
  maskSecret,
} from "../providers/config.js";
import { applyProviderDefaults, normalizeProviderId } from "../providers/catalog.js";
import { listRuntimeProviders, resolveRuntimeProvider } from "../providers/runtime.js";
import {
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_PROVIDER_ID,
} from "../constants/openrouter.js";

export type TabId = "config" | "provider" | "model" | "api-key";

// ---------------------------------------------------------------------------
// OpenRouter model fetching
// ---------------------------------------------------------------------------

interface OpenRouterModel {
  id: string;
  name?: string;
}

const MANUAL_VALUE = "__manual__";

async function fetchOpenRouterModels(apiKey: string, baseUrl: string): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/TheSethRose/Pebble-Code",
    "X-Title": "Pebble Code",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { data?: OpenRouterModel[] };
  return (json.data ?? []).sort((a, b) => a.id.localeCompare(b.id));
}


interface SettingsProps {
  context: CommandContext;
  onClose: () => void;
  defaultTab?: TabId;
}

function ensureProviderDefaults(settings: Settings): Settings {
  const withDefaults = applyProviderDefaults(settings);
  if (withDefaults.provider === OPENROUTER_PROVIDER_ID) {
    return {
      ...withDefaults,
      model: withDefaults.model?.trim() || OPENROUTER_DEFAULT_MODEL,
      baseUrl: withDefaults.baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL,
    };
  }

  return {
    ...withDefaults,
    model: withDefaults.model?.trim(),
    baseUrl: withDefaults.baseUrl?.trim(),
  };
}

const TABS: { id: TabId; label: string }[] = [
  { id: "config", label: "Config" },
  { id: "provider", label: "Provider" },
  { id: "model", label: "Model" },
  { id: "api-key", label: "API Key" },
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
}: {
  context: CommandContext;
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const [message, setMessage] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  const resolved = resolveRuntimeProvider(settings, {}, context.extensionProviders ?? []);

  const providerOptions = useMemo<Array<{ label: string; value: string }>>(() => {
    const dynamicProviders = listRuntimeProviders(context.extensionProviders ?? []).map((provider) => ({
      label: provider.source === "extension"
        ? `${provider.name}  (${provider.id}, extension)`
        : `${provider.name}  (${provider.id})`,
      value: provider.id,
    }));

    return [
      ...dynamicProviders,
      { label: "⌨  Type provider ID manually…", value: PROVIDER_MANUAL_VALUE },
    ];
  }, [context.extensionProviders]);

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
      if (provider === settings.provider) return;
      const next = ensureProviderDefaults({
        ...settings,
        provider,
        model: undefined,
        baseUrl: undefined,
      });
      onSave(next);
      setMessage(`Provider set to ${provider}`);
    },
    [settings, onSave],
  );

  const handleManualSubmit = useCallback(
    (value: string) => {
      const provider = normalizeProviderId(value);
      if (!provider) {
        setMessage("Provider ID cannot be empty");
        return;
      }
      const next = ensureProviderDefaults({
        ...settings,
        provider,
        model: undefined,
        baseUrl: undefined,
      });
      onSave(next);
      setMessage(`Provider set to ${provider}`);
    },
    [settings, onSave],
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
}: {
  context: CommandContext;
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  const resolved = resolveRuntimeProvider(settings, {}, context.extensionProviders ?? []);

  useEffect(() => {
    if (resolved.providerId !== OPENROUTER_PROVIDER_ID || !resolved.apiKey || showManual) return;
    setLoading(true);
    setLoadError("");
    fetchOpenRouterModels(resolved.apiKey, resolved.baseUrl)
      .then((mods) => {
        setModels(mods);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        setShowManual(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.apiKey, resolved.baseUrl, resolved.providerId]);

  const modelOptions = useMemo(() => {
    const opts = models.map((m) => ({
      label: m.name ? `${m.id}  —  ${m.name}` : m.id,
      value: m.id,
    }));
    opts.push({ label: "⌨  Type model ID manually…", value: MANUAL_VALUE });
    return opts;
  }, [models]);

  const filteredOptions = useMemo(() => {
    if (!filterQuery.trim()) return modelOptions;
    const q = filterQuery.toLowerCase();
    return modelOptions.filter(
      (opt) => opt.value === MANUAL_VALUE || opt.label.toLowerCase().includes(q),
    );
  }, [modelOptions, filterQuery]);

  const showPicker = !showManual && models.length > 0 && !loading;

  // Capture printable characters + backspace for filtering when picker is visible
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
    { isActive: showPicker },
  );

  const handleSelectChange = useCallback(
    (value: string) => {
      if (value === MANUAL_VALUE) {
        setShowManual(true);
        return;
      }
      if (value === settings.model) return;
      const next = ensureProviderDefaults({ ...settings, model: value });
      onSave(next);
      setMessage(`Model set to ${value}`);
    },
    [settings, onSave],
  );

  const handleTextSubmit = useCallback(
    (value: string) => {
      if (!value.trim()) {
        setMessage("Model name cannot be empty");
        return;
      }
      const next = ensureProviderDefaults({ ...settings, model: value.trim() });
      onSave(next);
      setMessage(`Model set to ${value.trim()}`);
    },
    [settings, onSave],
  );

  const matchCount = filterQuery.trim()
    ? filteredOptions.filter((o) => o.value !== MANUAL_VALUE).length
    : models.length;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Model</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>Current: {resolved.model}</Text>

        {loading && (
          <Box marginTop={1}>
            <Text dimColor>Loading models from OpenRouter…</Text>
          </Box>
        )}

        {loadError && (
          <Box marginTop={1}>
            <Text color="red">Could not load model list: {loadError}</Text>
          </Box>
        )}

        {(resolved.providerId !== OPENROUTER_PROVIDER_ID || !resolved.apiKey) && !loading && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">
              {resolved.providerId === OPENROUTER_PROVIDER_ID
                ? "No API key — configure via the API Key tab to load model list."
                : "This provider is managed by an extension — enter a model manually if it supports overrides."}
            </Text>
            <Box marginTop={1}>
              <Text color="cyan">{"› "} </Text>
              <TextInput
                onSubmit={handleTextSubmit}
                placeholder={`Model ID (e.g. ${OPENROUTER_DEFAULT_MODEL})`}
              />
            </Box>
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
                  ? `${matchCount} of ${models.length} models`
                  : `${models.length} models · type to filter`}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Select
                key={filterQuery}
                options={filteredOptions}
                visibleOptionCount={10}
                defaultValue={resolved.model}
                onChange={handleSelectChange}
                highlightText={filterQuery || undefined}
              />
            </Box>
          </Box>
        )}

        {(showManual || (!loading && !showPicker && !loadError && resolved.apiKey)) && (
          <Box flexDirection="column" marginTop={1}>
            {showManual && models.length > 0 && (
              <Text dimColor>Manual entry:</Text>
            )}
            <Box marginTop={1}>
              <Text color="cyan">{"› "} </Text>
              <TextInput
                onSubmit={handleTextSubmit}
                placeholder={`Model ID (e.g. ${OPENROUTER_DEFAULT_MODEL})`}
              />
            </Box>
          </Box>
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
          {showPicker
            ? "Type to filter · ↑↓ navigate · Enter select · Tab to switch sections"
            : "Enter to save · Tab to switch sections"}
        </Text>
      </Box>
    </Box>
  );
}

function ApiKeyTab({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const [message, setMessage] = useState("");

  const handleSubmit = useCallback(
    (value: string) => {
      if (!value.trim()) {
        setMessage("API key cannot be empty");
        return;
      }
      const next = ensureProviderDefaults({
        ...settings,
        apiKey: value.trim(),
      });
      onSave(next);
      setMessage("API key saved to Pebble settings");
    },
    [settings, onSave],
  );

  const resolved = resolveProviderConfig(settings);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">API Key</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          Status:{" "}
          {resolved.apiKeyConfigured
            ? `configured via ${resolved.apiKeySource} (${maskSecret(resolved.apiKey)})`
            : "not configured"}
        </Text>
        <Text>Env key: {resolved.envKeyName}</Text>
        <Box marginTop={1}>
          <Text color="cyan">{"› "} </Text>
          <TextInput
            onSubmit={handleSubmit}
            placeholder="API key (saved to ~/.pebble/settings.json)"
          />
        </Box>
        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith("API key") ? "red" : "green"}>
              {message}
            </Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter to save · Shift+Tab / Tab to switch sections</Text>
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
    ensureProviderDefaults(loadSettingsForCwd(context.cwd)),
  );
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

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
          <ProviderTab context={context} settings={settings} onSave={handleSave} />
        )}
        {activeTab === "model" && (
          <ModelTab context={context} settings={settings} onSave={handleSave} />
        )}
        {activeTab === "api-key" && (
          <ApiKeyTab settings={settings} onSave={handleSave} />
        )}
      </Box>

      <Box justifyContent="space-between" marginTop={1}>
        <Text dimColor>Esc to close</Text>
        <Text dimColor>Reference-style tabbed panel</Text>
      </Box>
    </Box>
  );
}
