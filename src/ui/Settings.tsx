import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import type { CommandContext } from "../commands/types.js";
import {
  loadSettingsForCwd,
  saveSettingsForCwd,
  getSettingsPath,
  type Settings,
} from "../runtime/config.js";
import {
  resolveProviderConfig,
  maskSecret,
} from "../providers/config.js";
import {
  normalizeProviderId,
  isSupportedProvider,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_PROVIDER_ID,
} from "../constants/openrouter.js";

type TabId = "config" | "provider" | "model" | "api-key";

interface SettingsProps {
  context: CommandContext;
  onClose: () => void;
  defaultTab?: TabId;
}

function ensureProviderDefaults(settings: Settings): Settings {
  const provider = normalizeProviderId(settings.provider);
  if (provider === OPENROUTER_PROVIDER_ID) {
    return {
      ...settings,
      provider,
      model: settings.model?.trim() || OPENROUTER_DEFAULT_MODEL,
      baseUrl: settings.baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL,
    };
  }
  return {
    ...settings,
    provider: OPENROUTER_PROVIDER_ID,
    model: settings.model?.trim() || OPENROUTER_DEFAULT_MODEL,
    baseUrl: settings.baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL,
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
  settings,
  settingsPath,
  cwd,
}: {
  settings: Settings;
  settingsPath: string;
  cwd: string;
}) {
  const resolved = resolveProviderConfig(settings);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Status</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>Working directory: {cwd}</Text>
        <Text>Settings file: {settingsPath}</Text>
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

function ProviderTab({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const [message, setMessage] = useState("");

  const handleSubmit = useCallback(
    (value: string) => {
      const provider = normalizeProviderId(value);
      if (!isSupportedProvider(provider)) {
        setMessage(`Unsupported provider: ${value}. Use: openrouter`);
        return;
      }
      const next = ensureProviderDefaults({ ...settings, provider });
      onSave(next);
      setMessage(`Provider set to ${provider}`);
    },
    [settings, onSave],
  );

  const resolved = resolveProviderConfig(settings);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Provider</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>Current: {resolved.providerLabel} ({resolved.providerId})</Text>
        <Text>Base URL: {resolved.baseUrl}</Text>
        <Box marginTop={1}>
          <Text color="cyan">{"› "} </Text>
          <TextInput
            onSubmit={handleSubmit}
            placeholder="Provider (e.g. openrouter)"
          />
        </Box>
        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith("Unsupported") ? "red" : "green"}>
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

function ModelTab({
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
        setMessage("Model name cannot be empty");
        return;
      }
      const next = ensureProviderDefaults({ ...settings, model: value.trim() });
      onSave(next);
      setMessage(`Model set to ${value.trim()}`);
    },
    [settings, onSave],
  );

  const resolved = resolveProviderConfig(settings);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Model</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>Current: {resolved.model}</Text>
        <Box marginTop={1}>
          <Text color="cyan">{"› "} </Text>
          <TextInput
            onSubmit={handleSubmit}
            placeholder="Model (e.g. anthropic/claude-sonnet-4.6)"
          />
        </Box>
        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith("Model name") ? "red" : "green"}>
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
      setMessage("API key saved to settings");
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
            placeholder="API key (saved to settings.json)"
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
            settings={settings}
            settingsPath={settingsPath}
            cwd={context.cwd}
          />
        )}
        {activeTab === "provider" && (
          <ProviderTab settings={settings} onSave={handleSave} />
        )}
        {activeTab === "model" && (
          <ModelTab settings={settings} onSave={handleSave} />
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
