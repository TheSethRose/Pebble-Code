import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("minimax-portal", "MiniMax Portal", {
  envKeys: ["MINIMAX_PORTAL_TOKEN"],
  defaultModel: "minimax/MiniMax-M2.7",
  exampleModels: ["minimax/MiniMax-M2.7"],
  authKind: "oauth",
  help: "Pebble has cataloged MiniMax Portal OAuth, but the built-in runtime still needs portal-auth session handling that stays separate from MiniMax API-key mode.",
});