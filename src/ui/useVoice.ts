import React from "react";
import { logVoiceDebug, logVoiceError } from "../voice/log.js";
import { getVoiceRuntime } from "../voice/runtime.js";
import type { FinalizeSource, VoiceConnectionOptions, VoiceStreamConnection } from "../voice/runtime.js";

type VoiceState = "idle" | "recording" | "processing";

type UseVoiceOptions = {
  enabled: boolean;
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  connectionOptions?: VoiceConnectionOptions;
};

type UseVoiceReturn = {
  state: VoiceState;
  audioLevels: number[];
  handleKeyEvent: (fallbackMs?: number) => void;
};

const RELEASE_TIMEOUT_MS = 200;
const REPEAT_FALLBACK_MS = 600;
const AUDIO_LEVEL_BARS = 16;

export function computeLevel(chunk: Buffer): number {
  const samples = chunk.length >> 1;
  if (samples === 0) {
    return 0;
  }

  let sumSq = 0;
  for (let index = 0; index < chunk.length - 1; index += 2) {
    const sample = ((chunk[index]! | (chunk[index + 1]! << 8)) << 16) >> 16;
    sumSq += sample * sample;
  }

  const rms = Math.sqrt(sumSq / samples);
  const normalized = Math.min(rms / 2000, 1);
  return Math.sqrt(normalized);
}

export function useVoice({ enabled, onTranscript, onError, connectionOptions }: UseVoiceOptions): UseVoiceReturn {
  const [state, setState] = React.useState<VoiceState>("idle");
  const [audioLevels, setAudioLevels] = React.useState<number[]>([]);

  const stateRef = React.useRef<VoiceState>("idle");
  const onTranscriptRef = React.useRef(onTranscript);
  const onErrorRef = React.useRef(onError);
  const connectionRef = React.useRef<VoiceStreamConnection | null>(null);
  const connectPromiseRef = React.useRef<Promise<VoiceStreamConnection | null> | null>(null);
  const transcriptRef = React.useRef("");
  const audioLevelsRef = React.useRef<number[]>([]);
  const audioBufferRef = React.useRef<Buffer[]>([]);
  const releaseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatFallbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRepeatRef = React.useRef(false);
  const sessionGenRef = React.useRef(0);

  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;

  const updateState = React.useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const cleanup = React.useCallback(() => {
    sessionGenRef.current += 1;

    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }

    if (repeatFallbackTimerRef.current) {
      clearTimeout(repeatFallbackTimerRef.current);
      repeatFallbackTimerRef.current = null;
    }

    getVoiceRuntime().stopRecording();
    connectionRef.current?.close();
    connectionRef.current = null;
    connectPromiseRef.current = null;
    transcriptRef.current = "";
    audioBufferRef.current = [];
    audioLevelsRef.current = [];
    setAudioLevels([]);
    seenRepeatRef.current = false;
  }, []);

  const finishRecording = React.useCallback(() => {
    const myGen = sessionGenRef.current;
    const isStale = () => sessionGenRef.current !== myGen;

    logVoiceDebug("[voice] finishRecording: stopping recording, transitioning to processing");
    updateState("processing");
    getVoiceRuntime().stopRecording();

    void (async () => {
      let connection = connectionRef.current;
      if (!connection && connectPromiseRef.current) {
        try {
          connection = await connectPromiseRef.current;
        } catch (error) {
          logVoiceError(error);
        }
      }

      if (isStale()) {
        return;
      }

      const finalizePromise: Promise<FinalizeSource | undefined> = connection
        ? connection.finalize()
        : Promise.resolve(undefined);

      try {
        const finalizeSource = await finalizePromise;
        if (isStale()) {
          return;
        }

        const text = transcriptRef.current.trim();
        connectionRef.current?.close();
        connectionRef.current = null;
        connectPromiseRef.current = null;
        transcriptRef.current = "";
        audioBufferRef.current = [];
        audioLevelsRef.current = [];
        setAudioLevels([]);

        if (text) {
          logVoiceDebug(`[voice] injecting transcript (${String(text.length)} chars)`);
          onTranscriptRef.current(text);
        } else if (finalizeSource !== "ws_already_closed") {
          onErrorRef.current?.("No speech detected.");
        }

        updateState("idle");
      } catch (error) {
        logVoiceError(error);
        if (!isStale()) {
          updateState("idle");
        }
      }
    })();
  }, [updateState]);

  const startRecordingSession = React.useCallback(async () => {
    const runtime = getVoiceRuntime();
    updateState("recording");
    transcriptRef.current = "";
    seenRepeatRef.current = false;
    audioBufferRef.current = [];
    audioLevelsRef.current = [];
    setAudioLevels([]);

    const myGen = ++sessionGenRef.current;
    const isStale = () => sessionGenRef.current !== myGen;

    const availability = await runtime.checkRecordingAvailability();
    if (!availability.available) {
      onErrorRef.current?.(availability.reason ?? "Audio recording is not available.");
      cleanup();
      updateState("idle");
      return;
    }

    const started = await runtime.startRecording(
      (chunk: Buffer) => {
        const owned = Buffer.from(chunk);
        if (connectionRef.current) {
          connectionRef.current.send(owned);
        } else {
          audioBufferRef.current.push(owned);
        }

        const level = computeLevel(chunk);
        const nextLevels = [...audioLevelsRef.current, level].slice(-AUDIO_LEVEL_BARS);
        audioLevelsRef.current = nextLevels;
        setAudioLevels(nextLevels);
      },
      () => {
        if (stateRef.current === "recording") {
          finishRecording();
        }
      },
      { silenceDetection: false },
    );

    if (!started) {
      onErrorRef.current?.("Failed to start audio capture. Check that your microphone is accessible.");
      cleanup();
      updateState("idle");
      return;
    }

    const connectPromise = runtime.connectVoiceStream({
      onTranscript: (text: string, isFinal: boolean) => {
        if (isStale() || !isFinal || !text.trim()) {
          return;
        }

        if (transcriptRef.current) {
          transcriptRef.current += " ";
        }
        transcriptRef.current += text.trim();
      },
      onError: (message: string) => {
        if (isStale()) {
          return;
        }

        onErrorRef.current?.(message);
        cleanup();
        updateState("idle");
      },
      onClose: () => {},
      onReady: (connection) => {
        if (isStale() || stateRef.current !== "recording") {
          connection.close();
          return;
        }

        connectionRef.current = connection;

        if (audioBufferRef.current.length > 0) {
          const buffered = audioBufferRef.current;
          audioBufferRef.current = [];
          const sliceTargetBytes = 32_000;
          let slice: Buffer[] = [];
          let sliceBytes = 0;

          for (const chunk of buffered) {
            if (sliceBytes > 0 && sliceBytes + chunk.length > sliceTargetBytes) {
              connection.send(Buffer.concat(slice));
              slice = [];
              sliceBytes = 0;
            }

            slice.push(chunk);
            sliceBytes += chunk.length;
          }

          if (slice.length > 0) {
            connection.send(Buffer.concat(slice));
          }
        }

        if (releaseTimerRef.current) {
          clearTimeout(releaseTimerRef.current);
          releaseTimerRef.current = null;
        }

        if (seenRepeatRef.current) {
          releaseTimerRef.current = setTimeout(() => {
            releaseTimerRef.current = null;
            if (stateRef.current === "recording") {
              finishRecording();
            }
          }, RELEASE_TIMEOUT_MS);
        }
      },
    }, connectionOptions);

    connectPromiseRef.current = connectPromise;

    void connectPromise.then((connection) => {
      if (isStale()) {
        connection?.close();
        return;
      }

      if (!connection) {
        onErrorRef.current?.("Voice mode could not connect to Parakeet STT.");
        cleanup();
        updateState("idle");
      }
    }).catch((error) => {
      logVoiceError(error);
      if (!isStale()) {
        onErrorRef.current?.(error instanceof Error ? error.message : String(error));
        cleanup();
        updateState("idle");
      }
    });
  }, [cleanup, connectionOptions, finishRecording, updateState]);

  const handleKeyEvent = React.useCallback((fallbackMs = REPEAT_FALLBACK_MS) => {
    const runtime = getVoiceRuntime();
    if (!enabled || !runtime.isVoiceStreamAvailable()) {
      return;
    }

    const currentState = stateRef.current;
    if (currentState === "processing") {
      return;
    }

    if (currentState === "idle") {
      void startRecordingSession();
      repeatFallbackTimerRef.current = setTimeout(() => {
        repeatFallbackTimerRef.current = null;
        if (stateRef.current === "recording" && !seenRepeatRef.current) {
          seenRepeatRef.current = true;
          releaseTimerRef.current = setTimeout(() => {
            releaseTimerRef.current = null;
            if (stateRef.current === "recording") {
              finishRecording();
            }
          }, RELEASE_TIMEOUT_MS);
        }
      }, fallbackMs);
      return;
    }

    if (currentState === "recording") {
      seenRepeatRef.current = true;
      if (repeatFallbackTimerRef.current) {
        clearTimeout(repeatFallbackTimerRef.current);
        repeatFallbackTimerRef.current = null;
      }
    }

    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }

    if (stateRef.current === "recording" && seenRepeatRef.current) {
      releaseTimerRef.current = setTimeout(() => {
        releaseTimerRef.current = null;
        if (stateRef.current === "recording") {
          finishRecording();
        }
      }, RELEASE_TIMEOUT_MS);
    }
  }, [enabled, finishRecording, startRecordingSession]);

  React.useEffect(() => {
    if (!enabled && stateRef.current !== "idle") {
      cleanup();
      updateState("idle");
    }

    return () => {
      cleanup();
    };
  }, [cleanup, enabled, updateState]);

  return {
    state,
    audioLevels,
    handleKeyEvent,
  };
}