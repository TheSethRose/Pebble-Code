import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("minimax", "MiniMax", {
  envKeys: ["MINIMAX_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged MiniMax API-key mode, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
});