import {
  buildCopilotIdeHeaders,
  DEFAULT_COPILOT_API_BASE_URL,
  deriveCopilotApiBaseUrlFromToken,
  GITHUB_COPILOT_ACCESS_TOKEN_URL,
  GITHUB_COPILOT_DEVICE_CLIENT_ID,
  GITHUB_COPILOT_DEVICE_CODE_URL,
  GITHUB_COPILOT_TOKEN_EXCHANGE_URL,
} from "../constants/githubCopilot.js";

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type DeviceTokenResponse =
  | {
      access_token: string;
      token_type: string;
      scope?: string;
    }
  | {
      error: string;
      error_description?: string;
      error_uri?: string;
    };

type CopilotTokenExchangeResponse = {
  token: string;
  expires_at: number | string;
};

function parseJsonResponse<T>(value: unknown, errorMessage: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(errorMessage);
  }

  return value as T;
}

async function requestGitHubDeviceCode(fetchImpl: typeof fetch): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: GITHUB_COPILOT_DEVICE_CLIENT_ID,
    scope: "read:user",
  });

  const response = await fetchImpl(GITHUB_COPILOT_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`GitHub device code failed: HTTP ${response.status}`);
  }

  const payload = parseJsonResponse<DeviceCodeResponse>(
    await response.json(),
    "Unexpected response from GitHub device-code endpoint",
  );

  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new Error("GitHub device code response missing required fields");
  }

  return payload;
}

async function waitFor(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForGitHubAccessToken(params: {
  fetchImpl: typeof fetch;
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: GITHUB_COPILOT_DEVICE_CLIENT_ID,
    device_code: params.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  while (Date.now() < params.expiresAt) {
    const response = await params.fetchImpl(GITHUB_COPILOT_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`GitHub device token failed: HTTP ${response.status}`);
    }

    const payload = parseJsonResponse<DeviceTokenResponse>(
      await response.json(),
      "Unexpected response from GitHub access-token endpoint",
    );

    if ("access_token" in payload && typeof payload.access_token === "string") {
      return payload.access_token;
    }

    const errorCode = "error" in payload ? payload.error : "unknown";
    if (errorCode === "authorization_pending") {
      await waitFor(params.intervalMs);
      continue;
    }

    if (errorCode === "slow_down") {
      await waitFor(params.intervalMs + 2_000);
      continue;
    }

    if (errorCode === "expired_token") {
      throw new Error("GitHub device code expired; run /login github-copilot again.");
    }

    if (errorCode === "access_denied") {
      throw new Error("GitHub Copilot login was cancelled.");
    }

    throw new Error(`GitHub device flow error: ${errorCode}`);
  }

  throw new Error("GitHub device code expired; run /login github-copilot again.");
}

function parseCopilotTokenExchangeResponse(value: unknown): {
  token: string;
  expiresAt: number;
} {
  const payload = parseJsonResponse<CopilotTokenExchangeResponse>(
    value,
    "Unexpected response from GitHub Copilot token endpoint",
  );

  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  if (!token) {
    throw new Error("Copilot token exchange response missing token");
  }

  const rawExpiresAt = payload.expires_at;
  let expiresAt: number | undefined;
  if (typeof rawExpiresAt === "number" && Number.isFinite(rawExpiresAt)) {
    expiresAt = rawExpiresAt < 100_000_000_000 ? rawExpiresAt * 1_000 : rawExpiresAt;
  } else if (typeof rawExpiresAt === "string" && rawExpiresAt.trim()) {
    const parsed = Number.parseInt(rawExpiresAt, 10);
    if (Number.isFinite(parsed)) {
      expiresAt = parsed < 100_000_000_000 ? parsed * 1_000 : parsed;
    }
  }

  if (!expiresAt) {
    throw new Error("Copilot token exchange response missing expires_at");
  }

  return { token, expiresAt };
}

export async function runGitHubCopilotDeviceLogin(options: {
  fetchImpl?: typeof fetch;
  writeLine?: (line: string) => void;
} = {}): Promise<{ githubToken: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const writeLine = options.writeLine ?? (() => {});
  const device = await requestGitHubDeviceCode(fetchImpl);

  writeLine("");
  writeLine("GitHub Copilot device login");
  writeLine(`Open ${device.verification_uri}`);
  writeLine(`Enter code: ${device.user_code}`);
  writeLine("Waiting for GitHub authorization...");

  const expiresAt = Date.now() + device.expires_in * 1_000;
  const intervalMs = Math.max(1_000, device.interval * 1_000);
  const githubToken = await pollForGitHubAccessToken({
    fetchImpl,
    deviceCode: device.device_code,
    intervalMs,
    expiresAt,
  });

  return { githubToken };
}

export async function resolveGitHubCopilotRuntimeAuth(params: {
  githubToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  apiKey: string;
  baseUrl: string;
  expiresAt: number;
}> {
  const githubToken = params.githubToken.trim();
  if (!githubToken) {
    throw new Error("GitHub Copilot is missing its GitHub access token. Run /login github-copilot.");
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(GITHUB_COPILOT_TOKEN_EXCHANGE_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubToken}`,
      ...buildCopilotIdeHeaders({ includeApiVersion: true }),
    },
  });

  if (!response.ok) {
    throw new Error(`Copilot token exchange failed: HTTP ${response.status}`);
  }

  const payload = parseCopilotTokenExchangeResponse(await response.json());
  return {
    apiKey: payload.token,
    baseUrl: deriveCopilotApiBaseUrlFromToken(payload.token) ?? DEFAULT_COPILOT_API_BASE_URL,
    expiresAt: payload.expiresAt,
  };
}
