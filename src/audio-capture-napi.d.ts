declare module "audio-capture-napi" {
  export function isNativeAudioAvailable(): boolean;
  export function isNativeRecordingActive(): boolean;
  export function startNativeRecording(
    onData: (data: Buffer) => void,
    onEnd: () => void,
  ): boolean;
  export function stopNativeRecording(): void;
}