import {
  applyProviderDefaults,
  normalizeProviderId,
} from "../providers/catalog.js";
import { runGitHubCopilotDeviceLogin } from "../providers/githubCopilot.js";
import {
  getStoredProviderCredential,
  getStoredProviderOAuthSession,
  setStoredProviderOAuthSession,
  type Settings,
} from "../runtime/config.js";
import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
} from "../constants/openrouter.js";

export function ensureSettingsProviderDefaults(settings: Settings): Settings {
  const withDefaults = applyProviderDefaults(settings);
  const oauthSession = getStoredProviderOAuthSession(withDefaults, withDefaults.provider);
  const activeCredential = getStoredProviderCredential(withDefaults, withDefaults.provider)
    ?? oauthSession?.accessToken?.trim()
    ?? oauthSession?.refreshToken?.trim();

  if (withDefaults.provider === OPENROUTER_PROVIDER_ID) {
    return {
      ...withDefaults,
      apiKey: activeCredential,
      model: withDefaults.model?.trim() || OPENROUTER_DEFAULT_MODEL,
      baseUrl: withDefaults.baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL,
    };
  }

  return {
    ...withDefaults,
    apiKey: activeCredential,
    model: withDefaults.model?.trim(),
    baseUrl: withDefaults.baseUrl?.trim(),
  };
}

export interface SettingsProviderLoginResult {
  nextSettings: Settings;
  message: string;
}

export async function runSettingsProviderLogin(params: {
  providerId: string;
  settings: Settings;
  writeLine?: (line: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<SettingsProviderLoginResult> {
  const providerId = normalizeProviderId(params.providerId);
  const currentSettings = params.settings;
  const switchingProvider = providerId !== normalizeProviderId(currentSettings.provider);

  switch (providerId) {
    case "github-copilot": {
      const oauth = await runGitHubCopilotDeviceLogin({
        fetchImpl: params.fetchImpl,
        writeLine: params.writeLine,
      });

      const nextSettings = ensureSettingsProviderDefaults(
        setStoredProviderOAuthSession(
          {
            ...currentSettings,
            provider: providerId,
            model: switchingProvider ? undefined : currentSettings.model,
            baseUrl: switchingProvider ? undefined : currentSettings.baseUrl,
          },
          providerId,
          {
            accessToken: oauth.githubToken,
            tokenType: "github-device",
          },
        ),
      );

      return {
        nextSettings,
        message: `Saved OAuth session for ${providerId}. GitHub Copilot runtime wiring is enabled, but live credential smoke tests are still pending.`,
      };
    }

    default:
      throw new Error(`Automatic settings login is not available for ${providerId} yet.`);
  }
}