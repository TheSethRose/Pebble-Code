import type { Command, CommandResult } from "../types.js";
import {
  applyProviderDefaults,
  getBuiltinProviderDefinition,
  getProviderAuthDescription,
  getProviderCredentialLabel,
  isSupportedProvider,
  normalizeProviderId,
  providerSupportsManualCredentialEntry,
} from "../../providers/catalog.js";
import {
  clearStoredProviderAuth,
  getSettingsPath,
  getStoredProviderOAuthSession,
  saveSettingsForCwd,
  setStoredProviderCredential,
  setStoredProviderOAuthSession,
} from "../../runtime/config.js";
import { openExternalUrl } from "../../runtime/openExternalUrl.js";
import { runGitHubCopilotDeviceLogin } from "../../providers/githubCopilot.js";
import { ensureProviderDefaults, getCurrentProviderId, loadProjectSettings, saveProjectSettings, createConfigUpdatedResult } from "./shared.js";

export function createLoginCommand(): Command {
  return {
    name: "login",
    aliases: ["auth"],
    description: "Configure authentication for a provider",
    type: "local",
    usage: "/login [provider] <credential>",
    modes: ["interactive"],
    execute: async (args, ctx): Promise<CommandResult> => {
      const trimmed = args.trim();
      if (!trimmed) {
        return {
          success: true,
          output: "",
          data: { action: "open-settings", defaultTab: "api-key" },
        };
      }

      const tokens = trimmed.split(/\s+/);
      const currentProvider = getCurrentProviderId(ctx);
      const providerOnlyInvocation = tokens.length === 1 && isSupportedProvider(tokens[0]);
      const explicitProvider = providerOnlyInvocation
        ? normalizeProviderId(tokens[0])
        : tokens.length > 1
          ? normalizeProviderId(tokens[0])
          : currentProvider;
      const apiKey = providerOnlyInvocation
        ? ""
        : tokens.length > 1
          ? tokens.slice(1).join(" ").trim()
          : tokens[0] ?? "";

      if (!isSupportedProvider(explicitProvider)) {
        return {
          success: true,
          output: `Unsupported provider: ${explicitProvider}. Choose a built-in provider from /provider or configure an extension provider instead.`,
        };
      }

      const definition = getBuiltinProviderDefinition(explicitProvider);
      if (!definition) {
        return {
          success: true,
          output: `Unsupported provider: ${explicitProvider}.`,
        };
      }

      if (definition.authKind === "oauth" && explicitProvider === "github-copilot" && (!apiKey || providerOnlyInvocation)) {
        const currentSettings = loadProjectSettings(ctx);
        const switchingProvider = explicitProvider !== normalizeProviderId(currentSettings.provider);
        const writeLine = (line: string) => {
          try {
            process.stdout.write(`${line}\n`);
          } catch {
            // Best-effort informational output only.
          }
        };

        const oauth = await runGitHubCopilotDeviceLogin({
          writeLine,
          openExternalUrl: async (url) => {
            const opener = ctx.openExternalUrl ?? openExternalUrl;
            return await opener(url);
          },
        });
        const nextSettings = ensureProviderDefaults(
          setStoredProviderOAuthSession(
            {
              ...currentSettings,
              provider: explicitProvider,
              model: switchingProvider ? undefined : currentSettings.model,
              baseUrl: switchingProvider ? undefined : currentSettings.baseUrl,
            },
            explicitProvider,
            {
              accessToken: oauth.githubToken,
              tokenType: "github-device",
            },
          ),
        );
        const settingsPath = saveProjectSettings(ctx, nextSettings);
        return createConfigUpdatedResult(
          `Saved OAuth session for ${nextSettings.provider} to ${settingsPath}. GitHub Copilot runtime wiring is enabled, but live credential smoke tests are still pending.`,
          settingsPath,
        );
      }

      if (!providerSupportsManualCredentialEntry(definition)) {
        const existingOauth = getStoredProviderOAuthSession(loadProjectSettings(ctx), explicitProvider);
        const configuredHint = existingOauth ? " An OAuth session is already saved for this provider." : "";
        return {
          success: true,
          output: `${definition.label} cannot be configured with a pasted ${getProviderCredentialLabel(definition)} in Pebble.${configuredHint} ${getProviderAuthDescription(definition)}`,
        };
      }

      if (!apiKey) {
        return { success: true, output: `Usage: /login [provider] <${getProviderCredentialLabel(definition)}>` };
      }

      const currentSettings = loadProjectSettings(ctx);
      const persistedProvider = normalizeProviderId(currentSettings.provider);
      const switchingProvider = explicitProvider !== persistedProvider;
      const nextSettings = ensureProviderDefaults(
        setStoredProviderCredential(
          {
            ...currentSettings,
            provider: explicitProvider,
            model: switchingProvider ? undefined : currentSettings.model,
            baseUrl: switchingProvider ? undefined : currentSettings.baseUrl,
          },
          explicitProvider,
          apiKey,
        ),
      );
      const settingsPath = saveProjectSettings(ctx, nextSettings);
      const implementationNote = definition.implemented
        ? ""
        : ` ${definition.label} is still cataloged-only, so live execution remains unimplemented or un-smoke-tested.`;
      return createConfigUpdatedResult(
        `Saved ${getProviderCredentialLabel(definition)} for ${nextSettings.provider} to ${settingsPath}.${implementationNote}`,
        settingsPath,
      );
    },
  };
}

export function createLogoutCommand(): Command {
  return {
    name: "logout",
    aliases: ["signout"],
    description: "Clear saved provider authentication",
    type: "local",
    usage: "/logout [provider ...]",
    modes: ["interactive"],
    execute: (args, ctx): CommandResult => {
      const settings = loadProjectSettings(ctx);
      const storedProviders = Object.entries(settings.providerAuth ?? {})
        .flatMap(([providerId, auth]) => {
          const hasCredential = Boolean(auth.credential?.trim());
          const hasOauth = Boolean(auth.oauth?.accessToken?.trim() || auth.oauth?.refreshToken?.trim());

          if (!hasCredential && !hasOauth) {
            return [];
          }

          const definition = getBuiltinProviderDefinition(providerId);
          const authModes = [
            ...(hasOauth ? ["OAuth session"] : []),
            ...(hasCredential ? [getProviderCredentialLabel(definition)] : []),
          ];

          return [{
            providerId,
            label: definition?.label ?? providerId,
            authModes,
          }];
        })
        .sort((left, right) => left.providerId.localeCompare(right.providerId));

      const trimmedArgs = args.trim();
      const selectedProviders = trimmedArgs
        ? [...new Set(trimmedArgs.split(/\s+/).map((value) => normalizeProviderId(value)).filter(Boolean))]
        : [];

      if (selectedProviders.length === 0) {
        if (storedProviders.length === 0) {
          return {
            success: true,
            output: `No stored provider auth found in ${getSettingsPath(ctx.cwd)}.`,
          };
        }

        return {
          success: true,
          output: [
            "Stored provider auth:",
            ...storedProviders.map((provider) => `- ${provider.providerId} (${provider.label}) — ${provider.authModes.join(" + ")}`),
            "Use /logout <provider> [provider...] to clear one or more saved auth entries.",
          ].join("\n"),
        };
      }

      let nextSettings = settings;
      const clearedProviders: string[] = [];
      const missingProviders: string[] = [];

      for (const providerId of selectedProviders) {
        const hasStoredAuth = Boolean(settings.providerAuth?.[providerId]?.credential?.trim()
          || settings.providerAuth?.[providerId]?.oauth?.accessToken?.trim()
          || settings.providerAuth?.[providerId]?.oauth?.refreshToken?.trim());

        if (!hasStoredAuth) {
          missingProviders.push(providerId);
          continue;
        }

        nextSettings = ensureProviderDefaults(clearStoredProviderAuth(nextSettings, providerId));
        clearedProviders.push(providerId);
      }

      if (clearedProviders.length === 0) {
        return {
          success: true,
          output: `No stored auth found for: ${missingProviders.join(", ")}.`,
        };
      }

      const settingsPath = saveSettingsForCwd(ctx.cwd, nextSettings);
      const output = [
        `Cleared saved auth for ${clearedProviders.join(", ")} in ${settingsPath}.`,
        ...(missingProviders.length > 0 ? [`No stored auth found for: ${missingProviders.join(", ")}.`] : []),
      ].join(" ");

      return createConfigUpdatedResult(output, settingsPath);
    },
  };
}

export function createPermissionsCommand(): Command {
  return {
    name: "permissions",
    aliases: ["perms", "trust"],
    description: "Show permission status",
    type: "local",
    usage: "/permissions",
    modes: ["interactive"],
    execute: (_args, ctx): CommandResult => {
      const decisions = ctx.permissionManager?.getDecisions() ?? [];
      return {
        success: true,
        output: [
          `Permission mode: ${ctx.permissionManager?.getMode() ?? "unknown"}`,
          `Persisted decisions: ${decisions.length}`,
          ...decisions.slice(0, 5).map((decision) => `  - ${decision.toolName}: ${decision.decision}`),
        ].join("\n"),
      };
    },
  };
}

export function createModelCommand(): Command {
  return {
    name: "model",
    aliases: ["m"],
    description: "Show or change the current model",
    type: "local",
    usage: "/model [model-name]",
    modes: ["interactive"],
    execute: (args, ctx): CommandResult => {
      if (args.trim()) {
        const settings = ensureProviderDefaults({
          ...loadProjectSettings(ctx),
          model: args.trim(),
        });
        const settingsPath = saveProjectSettings(ctx, settings);
        return createConfigUpdatedResult(
          `Model set to ${args.trim()}. Saved to ${settingsPath}.`,
          settingsPath,
        );
      }

      return {
        success: true,
        output: "",
        data: { action: "open-settings", defaultTab: "model" },
      };
    },
  };
}