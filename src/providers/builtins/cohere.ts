import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("cohere", "Cohere", {
  envKeys: ["COHERE_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged Cohere, but the built-in runtime still needs a Cohere-specific adapter, config path, and failure handling rather than the shared OpenAI-compatible transport.",
});