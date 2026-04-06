import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("minimax", "MiniMax", {
  envKeys: ["MINIMAX_API_KEY"],
  defaultModel: "minimax/MiniMax-M2.7",
  exampleModels: ["minimax/MiniMax-M2.7"],
  authKind: "api-key",
  help: "Pebble has cataloged MiniMax API-key mode, but the built-in runtime still needs a verified provider-specific endpoint/default-model path that stays distinct from the portal-auth surface.",
});