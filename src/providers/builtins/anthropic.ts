import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("anthropic", "Anthropic", {
  envKeys: ["ANTHROPIC_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged Anthropic, but the built-in runtime still needs a dedicated Anthropic adapter instead of the current OpenAI-compatible transport.",
});