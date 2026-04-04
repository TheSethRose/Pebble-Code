export const GITHUB_COPILOT_DEVICE_CLIENT_ID = "Iv1.b507a08c87ecfe98";
export const GITHUB_COPILOT_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_COPILOT_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_COPILOT_TOKEN_EXCHANGE_URL = "https://api.github.com/copilot_internal/v2/token";
export const DEFAULT_COPILOT_API_BASE_URL = "https://api.individual.githubcopilot.com";
export const COPILOT_EDITOR_VERSION = "vscode/1.96.2";
export const COPILOT_USER_AGENT = "GitHubCopilotChat/0.26.7";
export const COPILOT_GITHUB_API_VERSION = "2025-04-01";

export function buildCopilotIdeHeaders(options: {
  includeApiVersion?: boolean;
} = {}): Record<string, string> {
  return {
    "Editor-Version": COPILOT_EDITOR_VERSION,
    "User-Agent": COPILOT_USER_AGENT,
    ...(options.includeApiVersion
      ? { "X-Github-Api-Version": COPILOT_GITHUB_API_VERSION }
      : {}),
  };
}

export function buildCopilotRequestHeaders(): Record<string, string> {
  return {
    ...buildCopilotIdeHeaders(),
    "Openai-Intent": "conversation-edits",
  };
}

function resolveCopilotProxyHost(proxyEndpoint: string): string | null {
  const trimmed = proxyEndpoint.trim();
  if (!trimmed) {
    return null;
  }

  const urlText = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(urlText);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function deriveCopilotApiBaseUrlFromToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEndpoint = match?.[1]?.trim();
  if (!proxyEndpoint) {
    return null;
  }

  const proxyHost = resolveCopilotProxyHost(proxyEndpoint);
  if (!proxyHost) {
    return null;
  }

  return `https://${proxyHost.replace(/^proxy\./i, "api.")}`;
}
