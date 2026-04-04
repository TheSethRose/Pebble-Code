import { resolveGitHubCopilotRuntimeAuth } from "../providers/githubCopilot.js";

export interface ProviderModel {
  id: string;
  name?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeProviderModelId(providerId: string, modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return "";
  }

  if (providerId === "github-copilot" && !trimmed.includes("/")) {
    return `github-copilot/${trimmed}`;
  }

  return trimmed;
}

function normalizeProviderModel(providerId: string, value: unknown): ProviderModel | null {
  if (typeof value === "string") {
    const id = normalizeProviderModelId(providerId, value);
    return id ? { id } : null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as {
    id?: unknown;
    model?: unknown;
    name?: unknown;
    label?: unknown;
  };
  const rawId = typeof record.id === "string"
    ? record.id
    : typeof record.model === "string"
      ? record.model
      : "";
  const id = normalizeProviderModelId(providerId, rawId);
  if (!id) {
    return null;
  }

  const rawName = typeof record.name === "string"
    ? record.name.trim()
    : typeof record.label === "string"
      ? record.label.trim()
      : "";

  return {
    id,
    ...(rawName ? { name: rawName } : {}),
  };
}

export function uniqueModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) {
      return false;
    }

    seen.add(model.id);
    return true;
  });
}

export function parseProviderModelsResponse(params: {
  providerId: string;
  value: unknown;
}): ProviderModel[] {
  if (!params.value || typeof params.value !== "object" || Array.isArray(params.value)) {
    return [];
  }

  const payload = params.value as {
    data?: unknown;
    models?: unknown;
  };
  const source = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];

  return uniqueModels(
    source
      .map((entry) => normalizeProviderModel(params.providerId, entry))
      .filter((entry): entry is ProviderModel => Boolean(entry))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

async function requestProviderModels(params: {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  requestHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<ProviderModel[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(params.requestHeaders ?? {}),
  };
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(`${trimTrailingSlash(params.baseUrl)}/models`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parseProviderModelsResponse({
    providerId: params.providerId,
    value: await response.json(),
  });
}

export async function fetchProviderModels(params: {
  providerId: string;
  apiKey: string;
  baseUrl: string;
  requestHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<ProviderModel[]> {
  if (params.providerId === "github-copilot") {
    const runtimeAuth = await resolveGitHubCopilotRuntimeAuth({
      githubToken: params.apiKey,
      fetchImpl: params.fetchImpl,
    });

    return requestProviderModels({
      providerId: params.providerId,
      apiKey: runtimeAuth.apiKey,
      baseUrl: runtimeAuth.baseUrl,
      requestHeaders: params.requestHeaders,
      fetchImpl: params.fetchImpl,
    });
  }

  return requestProviderModels(params);
}