import { logVoiceDebug, logVoiceError } from "./log.js";
import {
  DEFAULT_VOICE_BASE_URL,
  DEFAULT_VOICE_MODEL,
  DEFAULT_VOICE_PROVIDER,
  DEFAULT_VOICE_TRANSCRIBE_PATH,
  normalizeVoiceBaseUrlValue,
  normalizeVoicePathValue,
  normalizeVoiceProviderValue,
} from "./config.js";

export type VoiceConnectionOptions = {
  language?: string;
  keyterms?: string[];
  provider?: string;
  baseUrl?: string;
  transcribePath?: string;
  model?: string;
};

export const FINALIZE_TIMEOUTS_MS = {
  safety: 30_000,
  noData: 1_500,
};

export type VoiceStreamCallbacks = {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string, opts?: { fatal?: boolean }) => void;
  onClose: () => void;
  onReady: (connection: VoiceStreamConnection) => void;
};

export type FinalizeSource =
  | "post_closestream_endpoint"
  | "no_data_timeout"
  | "safety_timeout"
  | "ws_close"
  | "ws_already_closed";

export type VoiceStreamConnection = {
  send: (audioChunk: Buffer) => void;
  finalize: () => Promise<FinalizeSource>;
  close: () => void;
  isConnected: () => boolean;
};

function createWavBuffer(
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmData.copy(buffer, 44);

  return buffer;
}

export function isVoiceStreamAvailable(): boolean {
  return true;
}

export async function connectVoiceStream(
  callbacks: VoiceStreamCallbacks,
  options?: VoiceConnectionOptions,
): Promise<VoiceStreamConnection | null> {
  const provider = normalizeVoiceProviderValue(options?.provider) ?? DEFAULT_VOICE_PROVIDER;
  const baseUrl = normalizeVoiceBaseUrlValue(options?.baseUrl ?? process.env.PARAKEET_STT_URL) ?? DEFAULT_VOICE_BASE_URL;
  const transcribePath = normalizeVoicePathValue(options?.transcribePath) ?? DEFAULT_VOICE_TRANSCRIBE_PATH;
  const model = normalizeVoiceProviderValue(options?.model) ?? DEFAULT_VOICE_MODEL;
  const audioChunks: Buffer[] = [];
  let active = true;

  const connection: VoiceStreamConnection = {
    send(audioChunk: Buffer): void {
      if (!active) {
        return;
      }

      audioChunks.push(Buffer.from(audioChunk));
    },

    async finalize(): Promise<FinalizeSource> {
      if (!active) {
        return "ws_already_closed";
      }

      active = false;

      if (audioChunks.length === 0) {
        callbacks.onClose();
        return "no_data_timeout";
      }

      const pcmData = Buffer.concat(audioChunks);
      audioChunks.length = 0;

      logVoiceDebug(`[parakeet_stt] sending ${String(pcmData.length)} bytes of PCM audio`);

      const wavBuffer = createWavBuffer(pcmData, 16_000, 1, 16);

      const safetyTimer = setTimeout(() => {
        logVoiceDebug("[parakeet_stt] safety timeout reached");
        callbacks.onError("Parakeet STT timed out", { fatal: false });
        callbacks.onClose();
      }, FINALIZE_TIMEOUTS_MS.safety);

      try {
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" }),
          "audio.wav",
        );
        formData.append("model", model);
        formData.append("response_format", "json");

        const url = `${baseUrl}${transcribePath}`;
        logVoiceDebug(`[voice:${provider}] POST ${url}`);

        const response = await fetch(url, {
          method: "POST",
          body: formData,
        });

        clearTimeout(safetyTimer);

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const message = `Parakeet STT error: HTTP ${String(response.status)}${body ? ` — ${body}` : ""}`;
          logVoiceDebug(`[parakeet_stt] ${message}`);
          callbacks.onError(message, {
            fatal: response.status >= 400 && response.status < 500,
          });
          callbacks.onClose();
          return "safety_timeout";
        }

        const result = await response.json() as { text?: string };
        const text = result.text?.trim();

        logVoiceDebug(`[parakeet_stt] transcription received: \"${text ?? ""}\"`);

        if (text) {
          callbacks.onTranscript(text, true);
        }

        callbacks.onClose();
        return "post_closestream_endpoint";
      } catch (error) {
        clearTimeout(safetyTimer);
        logVoiceError(error);
        const message = error instanceof Error ? error.message : String(error);
        callbacks.onError(`Parakeet STT connection error: ${message}`, { fatal: false });
        callbacks.onClose();
        return "safety_timeout";
      }
    },

    close(): void {
      active = false;
      audioChunks.length = 0;
    },

    isConnected(): boolean {
      return active;
    },
  };

  logVoiceDebug("[parakeet_stt] connection ready (REST backend)");
  callbacks.onReady(connection);

  return connection;
}