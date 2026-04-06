import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("anthropic", "Anthropic", {
  envKeys: ["ANTHROPIC_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged Anthropic, but the built-in runtime still needs a dedicated Anthropic adapter, provider-specific tool use support, and Anthropic-native error handling instead of the shared OpenAI-compatible transport.",
});