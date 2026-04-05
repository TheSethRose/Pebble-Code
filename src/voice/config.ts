export const DEFAULT_VOICE_PROVIDER = "parakeet-local";
export const DEFAULT_VOICE_BASE_URL = "http://localhost:5092";
export const DEFAULT_VOICE_TRANSCRIBE_PATH = "/v1/audio/transcriptions";
export const DEFAULT_VOICE_MODEL = "whisper-1";

export function normalizeVoiceProviderValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeVoiceBaseUrlValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().replace(/\/+$/u, "");
  return trimmed || undefined;
}

export function normalizeVoicePathValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}