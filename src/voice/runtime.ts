import {
  checkRecordingAvailability,
  checkVoiceDependencies,
  requestMicrophonePermission,
  startRecording,
  stopRecording,
} from "./voice.js";
import {
  connectVoiceStream,
  isVoiceStreamAvailable,
  type FinalizeSource,
  type VoiceConnectionOptions,
  type VoiceStreamCallbacks,
  type VoiceStreamConnection,
} from "./voiceStreamSTT.js";

export type {
  FinalizeSource,
  VoiceConnectionOptions,
  VoiceStreamCallbacks,
  VoiceStreamConnection,
} from "./voiceStreamSTT.js";

export interface VoiceRuntime {
  checkRecordingAvailability: typeof checkRecordingAvailability;
  checkVoiceDependencies: typeof checkVoiceDependencies;
  requestMicrophonePermission: typeof requestMicrophonePermission;
  startRecording: typeof startRecording;
  stopRecording: typeof stopRecording;
  connectVoiceStream: typeof connectVoiceStream;
  isVoiceStreamAvailable: typeof isVoiceStreamAvailable;
}

const realVoiceRuntime: VoiceRuntime = {
  checkRecordingAvailability,
  checkVoiceDependencies,
  requestMicrophonePermission,
  startRecording,
  stopRecording,
  connectVoiceStream,
  isVoiceStreamAvailable,
};

let voiceRuntime: VoiceRuntime = realVoiceRuntime;

export function getVoiceRuntime(): VoiceRuntime {
  return voiceRuntime;
}

export function setVoiceRuntimeForTesting(runtime: VoiceRuntime | null): void {
  voiceRuntime = runtime ?? realVoiceRuntime;
}