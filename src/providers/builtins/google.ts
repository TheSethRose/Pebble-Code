import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("google", "Google Gemini", {
  envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  aliases: ["gemini"],
  authKind: "api-key",
  help: "Pebble has cataloged Google Gemini API-key mode, but the built-in runtime still needs a Gemini-specific adapter, tool-use handling, and provider-specific error behavior.",
});