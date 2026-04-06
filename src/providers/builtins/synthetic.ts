import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("synthetic", "Synthetic", {
  envKeys: ["SYNTHETIC_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged Synthetic, but the built-in runtime still needs an Anthropic-compatible adapter instead of the shared OpenAI-compatible transport.",
});