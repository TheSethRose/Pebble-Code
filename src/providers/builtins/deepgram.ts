import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("deepgram", "Deepgram", {
  envKeys: ["DEEPGRAM_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged Deepgram, but it belongs on a media/transcription tool path instead of Pebble's chat-model runtime and still needs dedicated audio-tool wiring.",
});