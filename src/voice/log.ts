const VOICE_DEBUG_ENABLED = Boolean(process.env.PEBBLE_DEBUG_VOICE?.trim());

export function logVoiceDebug(message: string): void {
  if (!VOICE_DEBUG_ENABLED) {
    return;
  }

  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // Best-effort debug logging only.
  }
}

export function logVoiceError(error: unknown): void {
  if (!VOICE_DEBUG_ENABLED) {
    return;
  }

  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  logVoiceDebug(`[voice:error] ${message}`);
}